/*
 * ══════════════════════════════════════════════════════════════════════════
 *  FORK de webOrdersController.js — PRODUCTOS TERMINADOS / PRENDAS
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  Copia FIEL tomada el 16-07-2026, todavía sin modificar.
 *
 *  POR QUÉ EXISTE: el alta de prendas necesita cambiar el orden de los pasos
 *  (bordar antes o después de estampar) y meter el nivel "prenda". Hacerlo
 *  sobre webOrdersController.js pondría en riesgo DTF, Sublimación, Impresión
 *  Directa, TPU y ECOUV, que entran todos por ahí. Este fork nos deja tocar
 *  con libertad: lo que se rompa acá, se rompe SOLO acá.
 *
 *  REGLAS:
 *    - Exports: `createWebOrder` (POST /api/prendas-orders/create y pedidos externos)
 *      y las 5 funciones de retiro WMS / personalización de prendasOrdersRoutes.
 *      Los ~30 exports que viajaron en la copia y ninguna ruta llamaba (Handy, MP,
 *      tótem, retiros, direcciones…) se podaron el 16/10/2026.
 *    - webOrdersController.js NO se toca. Es la fuente de verdad del portal.
 *    - Divergencias futuras van marcadas con  // [PRENDAS]  para que se vea
 *      de un vistazo qué se apartó del original.
 *
 *  PENDIENTE (lo vamos armando juntos):
 *    1. ~~Podar los exports que no se usan.~~ Hecho 16/10/2026.
 *    2. Sort de pendingOrderExecutions por la secuencia elegida (hoy: Numero).
 *    3. Nivel prenda: PedidoItems + Ordenes.ItemID.
 *    4. Logistica_BultoDetalle (un bulto trae varias prendas).
 *    5. Estado "En Diseño" por paso que espera su archivo.
 */

const { sql, getPool } = require('../config/db');
const { siguienteCodigoVenta } = require('../utils/codigoVenta');
const logger = require('../utils/logger');
const { calcularFechasOrden } = require('../services/fechaPrometidaService');
const ERPSyncService = require('../services/erpSyncService');
const { construirNombreArchivo, materialParaNombre, usaNombreNuevo } = require('../utils/nombreArchivoOrden');
const { descontarStockWmsExterno } = require('../services/wmsStockService');
const { marcarRequisitoNoAplica } = require('../utils/requisitosAutoCumplimiento');

// --- CONSTANTES Y MAPEOS ---
const SERVICE_TO_AREA_MAP = {
    'dtf': 'DF',
    'DF': 'DF',
    'sublimacion': 'SB',
    'ecouv': 'ECOUV',
    'directa_320': 'DIRECTA',
    'directa_algodon': 'DIRECTA',
    'bordado': 'EMB',
    'laser': 'TWC',
    'tpu': 'TPU',
    'costura': 'TWT',
    'estampado': 'EST'
};

// ══════════════════════════════════════════════════════════════════════════
// [PRENDAS] "Comprar y personalizar" — Retiro WMS pendiente
// ══════════════════════════════════════════════════════════════════════════
// Equivalente de getPendingOrders/confirmPreparation (logisticaWmsController.js)
// pero apuntando a Ordenes en vez de PedidosCobranza: la prenda comprada ya
// no pasa por WMS/VEN-xxx, es una Orden real (PRODUCTO_TERMINADO) que además
// bloquea a sus hermanas de Bordado/DTF/TPU hasta que se confirme el retiro.

// [PRENDAS] Igual que el flujo VEN (Iniciar Preparación / Confirmar Preparación): el
// almacenero necesita saber cuáles ya empezó a preparar y poder ajustar la cantidad real
// antes de descontar del WMS (puede variar del pedido original por faltante de stock).
const ESTADOS_RETIRO_WMS = ['ESPERANDO_RETIRO_WMS', 'EN_PREPARACION_WMS'];

// ══════════════════════════════════════════════════════════════════════════
// [CONFIGURADOR] Qué personalización admite cada ARTÍCULO DE STOCK
// ══════════════════════════════════════════════════════════════════════════
// Un artículo del stock del local (Gorro de lana, Pet Film, Tinta...) no tiene servicios
// propios: lo que se le puede hacer lo define el Configurador a través de los productos
// con origen "Producto del local" (OrigenTipo LOCAL, o AMBOS = local o del cliente) que
// apuntan a él por ProductoVentaConfig.OrigenProIdProducto. Si existe "Gorro de lana
// bordado" con origen = Gorro de lana y Bordado habilitado, el Gorro de lana admite
// Bordado. Lo que ningún producto del Configurador habilita para ese artículo, no se
// puede pedir — así un Pet Film no puede bordarse ni estamparse.
//
// Devuelve { [ProIdProducto]: ['EMB', 'DF', ...] }; un artículo sin nada queda con [].
// Estampado (EST) no se lista: no se elige suelto, lo arrastra DTF o TPU.
const AREAS_DECORACION = ['EMB', 'DF', 'TPU'];
// F1 (29-sep): áreas que pueden ser la producción PRINCIPAL de un producto fabricado a medida
// (sublimación, impresión directa, gran formato). En la cadena Principal → Corte → Costura → …
// se comportan igual que SB; cuál es la del producto lo dice ProductoVentaConfig.TecnicaPrincipal.
const AREAS_PRINCIPAL_IMPRESION = ['SB', 'DIRECTA', 'ECOUV'];

// Regla PROVISORIA (16-09-2026, pedida por el usuario) mientras los artículos del local no
// estén cargados en el Configurador: se personaliza la ropa y los productos del local, no
// los insumos ni los materiales. Se decide por la familia de stock del artículo:
//   2.2.1.2 → productos del local (shorts, gorros, cuellos, medias...) → admiten todo
//   2.2.1.1 → insumos (Pet Film, tintas)                                → nada
//   1.x     → materiales (telas, lonas, vinilos, papel)                 → nada
// OJO: 2.2.1.2 también tiene artículos que no son ropa (hoy: Caña, Auriculares); esos
// quedan habilitados hasta que se carguen en el Configurador o se muevan de familia.
const CODSTOCK_PERSONALIZABLE = ['2.2.1.2'];

async function personalizacionAdmitidaPorArticulo(pool, proIds) {
    const ids = [...new Set((proIds || []).map(n => parseInt(n, 10)).filter(Number.isFinite))];
    const mapa = {};
    ids.forEach(id => { mapa[id] = []; });
    if (!ids.length) return mapa;
    // ids ya son enteros parseados: se pueden interpolar sin riesgo.

    // 1) Lo que dice el Configurador (productos "del local" que salen de ese artículo).
    const r = await pool.request().query(`
        SELECT DISTINCT vc.OrigenProIdProducto AS ProId, UPPER(LTRIM(RTRIM(s.AreaID))) AS AreaID
        FROM dbo.ProductoVentaConfig vc
        INNER JOIN dbo.ProductoTerminadoServicios s ON s.ProIdProducto = vc.ProIdProducto
        WHERE vc.OrigenTipo IN ('LOCAL', 'AMBOS')
          AND vc.OrigenProIdProducto IN (${ids.join(',')})
          AND UPPER(LTRIM(RTRIM(s.AreaID))) IN ('${AREAS_DECORACION.join("','")}')
    `);
    const enConfigurador = new Set();
    r.recordset.forEach(row => {
        enConfigurador.add(row.ProId);
        if (!mapa[row.ProId]) mapa[row.ProId] = [];
        if (!mapa[row.ProId].includes(row.AreaID)) mapa[row.ProId].push(row.AreaID);
    });

    // 2) Lo que NO está en el Configurador: regla provisoria por familia de stock.
    const sinConfig = ids.filter(id => !enConfigurador.has(id));
    if (sinConfig.length) {
        const fam = await pool.request().query(`
            SELECT ProIdProducto, LTRIM(RTRIM(CodStock)) AS CodStock
            FROM dbo.Articulos WHERE ProIdProducto IN (${sinConfig.join(',')})
        `);
        fam.recordset.forEach(row => {
            if (CODSTOCK_PERSONALIZABLE.includes(row.CodStock)) mapa[row.ProIdProducto] = [...AREAS_DECORACION];
        });
    }
    return mapa;
}

// GET /api/prendas-orders/personalizacion-admitida?ids=474,440
exports.getPersonalizacionAdmitida = async (req, res) => {
    try {
        const pool = await getPool();
        const ids = String(req.query.ids || '').split(',');
        res.json({ success: true, data: await personalizacionAdmitidaPorArticulo(pool, ids) });
    } catch (e) {
        logger.error('[Prendas] getPersonalizacionAdmitida:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// GET /api/prendas-orders/retiros-wms-pendientes
exports.getRetirosWmsPendientes = async (req, res) => {
    try {
        const pool = await getPool();
        // [PRENDAS] La fila a mostrar es la prenda comprada, no sus hermanas de
        // personalización (Bordado/DTF/TPU) — todas comparten EstadoDependencia, pero
        // SOLO la prenda tiene WmsVarianteId. No filtramos por el prefijo PROD- del
        // código porque ese depende de que el artículo ya esté marcado PRODUCTO_TERMINADO
        // en StockArt (dato de catálogo, no siempre cargado) — WmsVarianteId es confiable
        // porque lo pone el frontend directo, sin depender de esa marca.
        const r = await pool.request().query(`
            SELECT OrdenID, CodigoOrden, NoDocERP, Cliente, DescripcionTrabajo,
                   Material, Magnitud, WmsVarianteId, FechaIngreso, EstadoDependencia
            FROM Ordenes
            WHERE EstadoDependencia IN ('${ESTADOS_RETIRO_WMS.join("','")}')
              AND WmsVarianteId IS NOT NULL
            ORDER BY FechaIngreso ASC
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[Prendas] getRetirosWmsPendientes:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/prendas-orders/:ordenId/iniciar-preparacion-retiro
exports.iniciarPreparacionRetiroWms = async (req, res) => {
    const { ordenId } = req.params;
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`
                UPDATE Ordenes SET EstadoDependencia = 'EN_PREPARACION_WMS'
                WHERE OrdenID = @OID AND EstadoDependencia = 'ESPERANDO_RETIRO_WMS' AND WmsVarianteId IS NOT NULL
            `);
        if (!r.rowsAffected[0]) {
            return res.json({ success: false, message: 'Esta orden no está esperando retiro WMS.' });
        }
        res.json({ success: true, message: 'Preparación iniciada' });
    } catch (e) {
        logger.error('[Prendas] iniciarPreparacionRetiroWms:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/prendas-orders/:ordenId/actualizar-cantidad-retiro
exports.actualizarCantidadRetiroWms = async (req, res) => {
    const { ordenId } = req.params;
    const nuevaCantidad = parseFloat(req.body?.nuevaCantidad);
    try {
        if (!Number.isFinite(nuevaCantidad) || nuevaCantidad <= 0) {
            return res.status(400).json({ error: 'Cantidad inválida.' });
        }
        const pool = await getPool();
        const r = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Mag', sql.VarChar(50), String(nuevaCantidad))
            .query(`
                UPDATE Ordenes SET Magnitud = @Mag
                WHERE OrdenID = @OID
                  AND EstadoDependencia IN ('${ESTADOS_RETIRO_WMS.join("','")}')
                  AND WmsVarianteId IS NOT NULL
            `);
        if (!r.rowsAffected[0]) {
            return res.json({ success: false, message: 'Esta orden no está esperando retiro WMS.' });
        }
        res.json({ success: true, message: 'Cantidad actualizada' });
    } catch (e) {
        logger.error('[Prendas] actualizarCantidadRetiroWms:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/prendas-orders/:ordenId/confirmar-retiro-wms
exports.confirmarRetiroWms = async (req, res) => {
    const { ordenId } = req.params;
    try {
        const pool = await getPool();
        const ordenRes = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`SELECT OrdenID, NoDocERP, WmsVarianteId, Magnitud, EstadoDependencia, ComboItemID FROM Ordenes WHERE OrdenID = @OID`);
        const orden = ordenRes.recordset[0];
        if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
        if (!ESTADOS_RETIRO_WMS.includes(orden.EstadoDependencia)) {
            return res.json({ success: false, message: `Esta orden no está esperando retiro WMS (estado actual: ${orden.EstadoDependencia || 'sin gate'}).` });
        }
        if (!orden.WmsVarianteId) {
            return res.status(400).json({ error: 'Esta orden no tiene wms_variante_id asociado — no se puede descontar stock.' });
        }

        // Descuento real de stock contra el WMS externo — misma lógica que
        // logisticaWmsController.confirmPreparation (helper compartido).
        const { wmsDisponible, wmsErrors } = await descontarStockWmsExterno([
            { wms_variante_id: orden.WmsVarianteId, Cantidad: parseFloat(orden.Magnitud) || 1 }
        ], { refTipo: 'ORDEN', refId: orden.OrdenID, refDoc: orden.NoDocERP }); // idempotencia del WMS interno

        if (!wmsDisponible) {
            return res.status(503).json({
                success: false,
                message: 'El WMS no está disponible. Verificá la conexión con el servidor de Johnson.',
                wmsErrors
            });
        }

        // Libera esta Orden + todas sus hermanas del mismo pedido que estén en el
        // mismo gate (Bordado/DTF/TPU esperando este mismo retiro).
        // [COMBOS] Un pedido puede tener MÁS DE UN retiro pendiente a la vez (un combo con
        // 2 componentes = 2 retiros independientes, ej. Gorro y Short). Sin escopar por
        // ComboItemID, confirmar el retiro del Gorro liberaría TAMBIÉN las hermanas del
        // Short (que todavía no se retiró). Sin combo (ComboItemID NULL en ambos lados),
        // el filtro es el de siempre: mismo comportamiento de hoy.
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const { changeOrderState } = require('../services/stateManagerService');
            // [VENTA x ITEM] Un retiro NUNCA libera a otro retiro. Con servicios por artículo
            // un mismo pedido puede tener varios artículos del carrito esperando retiro a la
            // vez (la Tinta y el Gorro, cada uno el suyo) y los dos son PRO con ComboItemID
            // NULL: sin este corte, confirmar el de la Tinta le sacaba el candado al del
            // Gorro y su stock nunca se descontaba. Las hermanas de verdad son los servicios
            // de decoración, que no se retiran de ningún lado (WmsVarianteId NULL).
            const hermanas = await new sql.Request(transaction)
                .input('NoDoc', sql.VarChar, String(orden.NoDocERP))
                .input('ComboItemID', sql.Int, orden.ComboItemID || null)
                .input('OID', sql.Int, orden.OrdenID)
                .query(`
                    SELECT OrdenID, AreaID FROM Ordenes
                    WHERE NoDocERP = @NoDoc AND EstadoDependencia IN ('${ESTADOS_RETIRO_WMS.join("','")}')
                      AND (ComboItemID = @ComboItemID OR (@ComboItemID IS NULL AND ComboItemID IS NULL))
                      AND (OrdenID = @OID OR WmsVarianteId IS NULL)
                `);
            for (const h of hermanas.recordset) {
                await new sql.Request(transaction)
                    .input('OID', sql.Int, h.OrdenID)
                    .query(`UPDATE Ordenes SET EstadoDependencia = 'OK' WHERE OrdenID = @OID`);
                await changeOrderState(transaction, {
                    target : { type: 'ORDER', id: h.OrdenID },
                    estado : 'Pendiente',
                    userObj: req.user || 'Sistema',
                    detalle: 'Retiro WMS confirmado',
                    guard  : "Estado = 'Cargando...'",
                    io     : req.app.get('socketio'),
                });
            }
            // [PRENDAS] El requisito "PRENDA" de Bordado/Estampado NO se cumple acá — recién
            // cuando el bulto de PRO llegue físicamente a esa área y se haga el check-in del
            // remito (receiveDispatch ya tiene el mecanismo "AUTO-FULFILL REQUIREMENT ON
            // CHECK-IN", que mira Areas.Entrega del área de ORIGEN). Ver migración
            // activar_entrega_area_pro.sql — solo falta que Areas.Entrega de 'PRO' diga
            // 'PRENDAS', igual que ya tienen EMB/EST/TWT.
            await transaction.commit();

            // [PRENDAS] Bulto físico del retiro: le dice al almacenero a qué área llevar
            // la prenda (campo DESTINO en la etiqueta = Ordenes.ProximoServicio, ya
            // apuntando a la primera personalización activa). Sin cotización todavía —
            // por eso addOneBulto, no regenerateLabelsForOrder (ese exige precio).
            let bultoWarning = null;
            try {
                const LabelGenerationService = require('../services/LabelGenerationService');
                const lr = await LabelGenerationService.addOneBulto(orden.OrdenID, req.user?.id || 1, req.user?.usuario || 'Sistema', {});
                if (!lr.success) bultoWarning = lr.error;
            } catch (eLab) {
                logger.warn('[Prendas] confirmarRetiroWms: no se pudo generar el bulto de retiro:', eLab.message);
                bultoWarning = eLab.message;
            }

            res.json({
                success: true,
                message: wmsErrors.length > 0 ? `Retiro confirmado con advertencias: ${wmsErrors.join('; ')}` : 'Retiro confirmado, stock descontado.',
                liberadas: hermanas.recordset.length,
                wmsErrors,
                bultoWarning
            });
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }
    } catch (e) {
        logger.error('[Prendas] confirmarRetiroWms:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// --- CONTROLADOR PRINCIPAL ---
exports.createWebOrder = async (req, res) => {
    logger.info("📥 [WebOrder] Iniciando proceso de creación (MODO STREAMING)...");

    // --- 1. DATOS BÁSICOS ---
    const {
        idServicio, nombreTrabajo, prioridad, notasGenerales, configuracion,
        especificacionesCorte, lineas, archivosReferencia, archivosTecnicos, serviciosExtras,
        bobinaId,  // TELA CLIENTE: BobinaID seleccionada por el usuario
        magnitud,  // TELA CLIENTE: metros del pedido a descontar de la bobina (top-level en el payload)
        tinta,     // ECOUV: tinta de impresión (Ecosolvente/UV) — rutea el lote a la máquina
        talles     // [PRENDAS] Roster del pedido completo (número/jugador/talle/categoría), no por servicio
    } = req.body;

    // Mapeo inverso para compatibilidad
    // Soporte para Payroads en Español (Renombrado técnico solicitado por usuario)
    // `idServicioBase` es la clave que manda el portal (PrendaOrderForm); sin ella `serviceId`
    // quedaba undefined y las ramas que dependen de él no corrían. Espeja webOrdersController.
    const serviceId = idServicio || req.body.idServicioBase || req.body.serviceId;
        // [CORTE/COSTURA] prendas del pedido = las de la orden madre (producto fabricado / comprado); si no hay madre, las de los servicios
        const prendasPedido = (req.body.servicios || [])
            .filter(x => x && (x.esProductoFabricado || x.esProductoComprado))
            .reduce((sum, x) => sum + (x.items || []).reduce((a, it) => a + (parseInt(it.cantidad) || 0), 0), 0)
            // [UNA ORDEN POR ARCHIVO] una orden partida por archivo puede llevar menos prendas que el pedido: no sirve de referencia
            || parseInt((req.body.servicios || []).find(x => x?.metadata?.prendas && !x.porArchivo)?.metadata?.prendas)
            || parseInt((req.body.servicios || []).find(x => x?.metadata?.prendas)?.metadata?.prendas) || 0;
    const jobName = nombreTrabajo || req.body.jobName;
    const urgency = prioridad || req.body.urgency || 'Normal';
    const generalNote = notasGenerales || req.body.generalNote;
    const items = lineas || req.body.items || [];
    const selectedComplementary = serviciosExtras || req.body.selectedComplementary || {};

    // ⚠️ IMPORTANTE: Ahora el frontend NO envía "file.data" (base64), envía solo metadata (nombre, tamaño)
    const referenceFiles = (archivosReferencia || req.body.referenceFiles || []).map(f => ({
        name: f.nombre || f.name,
        type: f.tipo || f.type
    }));
    const specializedFiles = (archivosTecnicos || req.body.specializedFiles || []).map(f => ({
        name: f.nombre || f.name,
        type: f.tipo || f.type
    }));
    const cuttingSpecs = especificacionesCorte || req.body.cuttingSpecs;

    const user = req.user || {};
    // SEGURIDAD: el cliente sale SIEMPRE del token (o de la impersonación validada de diseñador,
    // que ya viene inyectada en req.user). El body NO puede elegir el cliente — antes se aceptaba
    // req.body.codCliente y cualquier token podía crear pedidos a nombre de otro.
    const codCliente = user.codCliente || null;
    let nombreCliente = user.name || user.username || 'Cliente Web';
    let idClienteReact = null;
    let cliIdCliente = null;

    if ((!items || items.length === 0) && (!req.body.servicios || req.body.servicios.length === 0)) {
        return res.status(400).json({ error: "El pedido no contiene ítems." });
    }

    // [COMBOS] Validar ANTES de crear nada: un componente sin wmsVarianteId no puede generar
    // su venta de retiro (ver bloque combosRetiro más abajo) — si el pedido se creara igual,
    // el servicio de decoración de ESE componente (Bordado/DTF) nacería en
    // ESPERANDO_RETIRO_WMS y quedaría trabado para siempre, sin ninguna venta que lo libere
    // (caso real: combo con el Gorro sin variante WMS vinculada en el Configurador — el
    // Bordado del Gorro nació y nunca se pudo confirmar). Mejor fallar acá, claro y antes de
    // gastar el correlativo del pedido, que dejar una orden fantasma.
    const combosRetiroBody = Array.isArray(req.body.combosRetiro) ? req.body.combosRetiro : [];
    const combosSinWms = combosRetiroBody.filter(c => !c.wmsVarianteId);
    if (combosSinWms.length > 0) {
        const nombres = combosSinWms.map(c => c.descripcion || `componente ${c.comboItemId}`).join(', ');
        // [ACCESORIOS] un accesorio de stock sin variante: falta elegir talle/color (o vincular el artículo al WMS)
        if (combosSinWms.every(c => c.esAccesorio)) {
            return res.status(400).json({ error: `No se puede confirmar: el accesorio de stock "${nombres}" no tiene variante de WMS elegida. Elegí talle/color del accesorio (o vinculá el artículo al WMS en Marketing › Productos).` });
        }
        return res.status(400).json({
            error: `No se puede confirmar: "${nombres}" no tiene una variante de WMS vinculada en el Configurador — avisá antes de reintentar, si se crea igual el servicio de decoración de ese componente queda esperando un retiro que nunca va a llegar.`
        });
    }

    // [CORTE/COSTURA] Defensa de fondo: en un pedido que fabrica la prenda (principal de impresión en tela)
    // no existe Costura sin Corte. Sin esta regla la tela iba de Sublimación directo a Costura (pedido 26025).
    {
        const srvPedido = Array.isArray(req.body.servicios) ? req.body.servicios : [];
        const areasPedido = srvPedido.map(x => String(x?.areaId || '').trim().toUpperCase());
        const fabricaTela = areasPedido.some(a => AREAS_PRINCIPAL_IMPRESION.includes(a));
        if (fabricaTela && areasPedido.includes('TWT') && !areasPedido.includes('TWC')) {
            return res.status(400).json({ error: 'No se puede confirmar: el pedido lleva Costura pero no Corte. No existe Costura sin Corte: agregá el Servicio de Corte.' });
        }
    }

    const pool = await getPool();

    // [CONFIGURADOR] Defensa de fondo: el formulario ya no ofrece lo que el Configurador no
    // habilita, pero un payload viejo o armado a mano no pasa por ahí. Se chequea ANTES de
    // reservar el número de pedido, para que un rechazo no queme un número.
    //  · "Comprar y personalizar": cada servicio de un artículo del carrito tiene que estar
    //    admitido para ESE artículo (personalizacionAdmitidaPorArticulo).
    //  · Producto terminado (no combo): los servicios sueltos tienen que estar entre los
    //    que el Configurador marcó para el producto (ProductoTerminadoServicios).
    // Si la consulta misma falla no se bloquea el pedido: el formulario es la primera
    // barrera y la creación falla igual si la base no responde.
    try {
        const srvBody = Array.isArray(req.body.servicios) ? req.body.servicios : [];
        const areaDe = (s) => String(s.areaId || '').trim().toUpperCase();
        const rechazos = [];

        // Artículos del carrito: viajan en articulosVenta de la PRO única (antes, una PRO por
        // artículo con grupoItemId). Los servicios de cada artículo llegan con comboItemId =
        // su wms_variante_id.
        const articulosCarrito = srvBody
            .filter(s => Array.isArray(s.articulosVenta))
            .flatMap(s => s.articulosVenta)
            .filter(x => x && x.proIdProducto && x.wmsVarianteId);
        if (articulosCarrito.length) {
            // [VENTA UNA LÍNEA] Todo artículo de un pedido personalizado tiene que llevar al menos
            // un servicio: el pedido sale entero por una sola PRO, así que uno sin personalizar
            // (una tinta) quedaría retenido hasta que esté lista la personalización del resto.
            // Lo que no se personaliza se vende en otro pedido.
            const sinServicio = articulosCarrito.filter(art =>
                !srvBody.some(s => !s.esPrincipal && String(s.comboItemId) === String(art.wmsVarianteId)
                    && AREAS_DECORACION.includes(areaDe(s))));
            if (sinServicio.length) {
                return res.status(400).json({
                    error: `No se puede confirmar: ${sinServicio.map(a => `"${a.descripcion || 'artículo'}"`).join(', ')} no lleva personalización. En un pedido personalizado todos los artículos se entregan juntos; lo que no se personaliza se vende en otro pedido.`
                });
            }
            const admitidos = await personalizacionAdmitidaPorArticulo(pool, articulosCarrito.map(x => x.proIdProducto));
            for (const art of articulosCarrito) {
                const permitidas = admitidos[parseInt(art.proIdProducto, 10)] || [];
                srvBody
                    .filter(s => !s.esPrincipal && String(s.comboItemId) === String(art.wmsVarianteId) && AREAS_DECORACION.includes(areaDe(s)))
                    .filter(s => !permitidas.includes(areaDe(s)))
                    .forEach(s => rechazos.push(`${art.descripcion || 'artículo'} no admite ${areaDe(s)}`));
            }
        }

        // Producto terminado simple: la PRO esProductoFabricado con artículo y SIN servicios
        // agrupados (un combo agrupa por componente y tiene sus propias reglas).
        const proTerminado = srvBody.find(s => s.esProductoFabricado && s.cabecera?.proIdProducto);
        // [ACCESORIOS] los retiros de accesorios de stock no hacen combo al pedido
        const esCombo = srvBody.some(s => s.comboItemId) || combosRetiroBody.some(c => !c.esAccesorio);
        if (proTerminado && !esCombo) {
            const permRes = await pool.request()
                .input('PID', sql.Int, parseInt(proTerminado.cabecera.proIdProducto, 10))
                .query(`SELECT UPPER(LTRIM(RTRIM(AreaID))) AS AreaID FROM dbo.ProductoTerminadoServicios WHERE ProIdProducto = @PID`);
            const permitidas = permRes.recordset.map(r => r.AreaID);
            srvBody
                .filter(s => !s.esPrincipal && !s.grupoItemId && AREAS_DECORACION.includes(areaDe(s)))
                .filter(s => !permitidas.includes(areaDe(s)))
                .forEach(s => rechazos.push(`${proTerminado.cabecera.material || 'el producto'} no incluye ${areaDe(s)}`));
        }

        if (rechazos.length) {
            return res.status(400).json({
                error: `No se puede confirmar: ${[...new Set(rechazos)].join('; ')}. Lo que se puede hacer a cada artículo se define en el Configurador de Productos.`
            });
        }
    } catch (eConf) {
        logger.warn(`[Prendas] No se pudo validar la personalización contra el Configurador: ${eConf.message}`);
    }

    try {
        // --- 2. RESERVAR NRO PEDIDO ---
        const reserveRes = await pool.request().query(`
            UPDATE ConfiguracionGlobal 
            SET Valor = CAST(ISNULL(CAST(Valor AS INT), 0) + 1 AS VARCHAR) 
            OUTPUT INSERTED.Valor 
            WHERE Clave = 'ULTIMOPEDIDOWEB'
        `);
        if (!reserveRes.recordset.length) throw new Error("No se pudo obtener el próximo número de pedido.");
        const nuevoNroPedido = parseInt(reserveRes.recordset[0].Valor);
        const erpDocNumber = `${nuevoNroPedido}`;

        if (codCliente) {
            const clientRes = await pool.request().input('cod', sql.Int, codCliente).query("SELECT CliIdCliente, IDReact, ESTADO, IDCliente, Nombre FROM Clientes WHERE CodCliente = @cod");
            if (clientRes.recordset.length > 0) {
                const clientData = clientRes.recordset[0];
                idClienteReact = clientData.IDReact;
                cliIdCliente = clientData.CliIdCliente;

                // Cliente del nombre = campo literal IDCliente (igual que las órdenes de ERP/Sheets).
                // Fallback al Nombre solo si IDCliente viene vacío.
                nombreCliente = (clientData.IDCliente && clientData.IDCliente.trim().length > 0)
                    ? clientData.IDCliente.trim()
                    : (clientData.Nombre || nombreCliente);

                // Bloquear creación de pedidos si el cliente está BLOQUEADO
                if (clientData.ESTADO === 'BLOQUEADO') {
                    logger.warn(`⛔ [WebOrder] Cliente CodCliente=${codCliente} está BLOQUEADO. Pedido rechazado.`);
                    return res.status(403).json({
                        error: 'Tu cuenta está bloqueada. No podés crear nuevos pedidos. Contactá con nosotros para regularizar tu situación.',
                        blocked: true
                    });
                }
            }
        }

        // --- 3. PREPARACIÓN DE ÁREAS Y RUTAS (Igual que antes) ---
        const mappingRes = await pool.request().query("SELECT AreaID_Interno, Numero FROM ConfigMapeoERP");
        const mapaAreasNumero = {}; // AreaID -> Numero (Priority/Order)
        mappingRes.recordset.forEach(r => mapaAreasNumero[r.AreaID_Interno.trim().toUpperCase()] = r.Numero || 999);
        const rutasRes = await pool.request().query("SELECT AreaOrigen, AreaDestino, Prioridad FROM ConfiguracionRutas");
        const rutasConfig = rutasRes.recordset;

        // NUEVO: Obtener UM de las Áreas
        const areasRes = await pool.request().query("SELECT AreaID, UM FROM Areas");
        const mapaAreasUM = {};
        areasRes.recordset.forEach(r => {
            if (r.AreaID) mapaAreasUM[r.AreaID.trim().toUpperCase()] = (r.UM || 'u').trim();
        });

        const mainAreaID = (SERVICE_TO_AREA_MAP[serviceId] || 'GENE').toUpperCase();

        // URGENCIA POR ÁREA: si el área principal no tiene urgencia activa (misma regla
        // que el motor de precios — perfil urgencia / AREAS_SIN_URGENCIA), se fuerza
        // 'Normal' aunque el payload diga otra cosa. El portal ya oculta el botón;
        // esto cubre payloads viejos/manuales. Fail-open si la config no se puede leer.
        let finalUrgency = urgency;
        if ((urgency || '').trim().toLowerCase() === 'urgente') {
            try {
                const { getAreasConUrgencia } = require('../utils/urgenciaAreas');
                const areasConUrgencia = await getAreasConUrgencia(pool);
                const areaPrincipal = (req.body.servicios?.find(s => s.esPrincipal)?.areaId || mainAreaID || '').toUpperCase();
                if (areaPrincipal && areaPrincipal !== 'GENE' && !areasConUrgencia.has(areaPrincipal)) {
                    finalUrgency = 'Normal';
                    logger.info(`[WebOrder] Área ${areaPrincipal} sin urgencia activa: prioridad forzada a Normal.`);
                }
            } catch (e) {
                logger.warn('[WebOrder] No se pudo evaluar urgencia por área:', e.message);
            }
        }

        // ... (Lógica de áreas extras se mantiene igual)
        const EXTRA_ID_TO_AREA = { 'EST': 'EST', 'ESTAMPADO': 'EST', 'COSTURA': 'TWT', 'CORTE': 'TWC', 'TWC': 'TWC', 'TWT': 'TWT', 'LASER': 'TWC', 'BORDADO': 'EMB', 'EMB': 'EMB' };

        // Inicializar conjunto de áreas activas
        const allActiveAreas = new Set([mainAreaID]); // Siempre incluye la principal

        // A) Desde Servicios Nuevos (Payload Nuevo)
        if (req.body.servicios && Array.isArray(req.body.servicios)) {
            req.body.servicios.forEach(s => {
                if (s.areaId) allActiveAreas.add(s.areaId.toUpperCase());
            });
        }

        // B) Legacy (selectedComplementary)
        if (selectedComplementary) {
            Object.entries(selectedComplementary).forEach(([id, val]) => {
                if (val.activo || val.active) {
                    const mapped = EXTRA_ID_TO_AREA[id.toUpperCase()];
                    if (mapped) allActiveAreas.add(mapped);
                }
            });
        }

        // --- 4. PREPARAR NOTA (Igual que antes) ---
        let finalNote = generalNote || '';
        const specs = [];
        if (cuttingSpecs) {
            specs.push(`MOLDE: ${cuttingSpecs.tipoMolde || cuttingSpecs.moldType || 'N/A'}`);
            specs.push(`ORIGEN TELA: ${cuttingSpecs.origenTela || cuttingSpecs.fabricOrigin || 'N/A'}`);
            if ((cuttingSpecs.nombreTelaCliente || cuttingSpecs.clientFabricName) && (cuttingSpecs.origenTela === 'TELA CLIENTE' || cuttingSpecs.fabricOrigin === 'TELA CLIENTE')) {
                specs.push(`TELA CLIENTE: ${cuttingSpecs.nombreTelaCliente || cuttingSpecs.clientFabricName}`);
            }
            if (cuttingSpecs.idOrdenSublimacionVinc || cuttingSpecs.sublimationOrderId) {
                specs.push(`ORDEN ASOCIADA: ${cuttingSpecs.idOrdenSublimacionVinc || cuttingSpecs.sublimationOrderId}`);
            }
        }
        // ... (Más specs de bordado/estampado, igual que antes)
        if (req.body.especificacionesBordado?.cantidadPrendas) specs.push(`BORDADO - CANTIDAD TOTAL DE PRENDAS: ${req.body.especificacionesBordado.cantidadPrendas}`);

        if (specs.length > 0) {
            finalNote = specs.join(' | ') + ' | ' + (generalNote || '');
        } else {
            finalNote = generalNote ? `OBS: ${generalNote}` : '';
        }

        // [PRENDAS] "Producto personalizado (cliente)" — solución puente mientras no está
        // configurado el catálogo real: la orden madre PRO usa el artículo genérico
        // 'PPERS' (Prenda Personalizada, PreciosBase $0, Mostrar=0). El front NO conoce
        // ese ProIdProducto: manda el flag esPrendaPersonalizada y acá se resuelve.
        // El modo de cobro viaja como marcador en la nota del servicio PRO
        // ([FACTURA POR AREA] / [PRECIO ESTABLECIDO: monto MONEDA]) — lo lee erpSyncService.
        let proIdPrendaPersonalizada = null;
        if (Array.isArray(req.body.servicios) && req.body.servicios.some(s => s.esPrendaPersonalizada)) {
            const rPers = await pool.request().query(`
                SELECT TOP 1 ProIdProducto FROM dbo.Articulos
                WHERE LTRIM(RTRIM(CodArticulo)) = 'PPERS' AND ISNULL(borrar, 0) = 0
            `);
            proIdPrendaPersonalizada = rPers.recordset[0]?.ProIdProducto || null;
            if (!proIdPrendaPersonalizada) {
                return res.status(400).json({
                    success: false,
                    message: "Falta el artículo genérico 'Prenda Personalizada' (PPERS) — correr backend/scripts/create_articulo_prenda_personalizada.sql."
                });
            }
        }

        // --- 5. ESTRUCTURAR ORDENES ---
        const pendingOrderExecutions = [];

        // CASO 1: ARRAY UNIFICADO DE SERVICIOS (Nuevo Frontend)
        if (req.body.servicios && Array.isArray(req.body.servicios) && req.body.servicios.length > 0) {
            req.body.servicios.forEach(srv => {
                const cabecera = srv.cabecera || {};
                const areaID = (srv.areaId || mainAreaID).toUpperCase();

                // SEPARAR ARCHIVOS: Producción vs Referencia
                const prodTypes = ['PRODUCCION', 'PRODUCCION_DORSO', 'IMPRESION'];
                const rawFiles = srv.archivos || [];

                // 1. Archivos Producción (Items) - Vinculados por nombre a los items del payload si existen
                // o creados dinámicamente si no hay items explícitos pero hay archivos prod.
                // Mapear Items del Servicio a Items de Orden
                const ordenItems = (srv.items || []).map(it => {
                    let obsTecnicas = it.printSettings?.observation || '';
                    // Enriquecer observación con datos técnicos de impresión si existen
                    if (it.printSettings) {
                        const parts = [];
                        if (it.printSettings.mode && it.printSettings.mode !== 'normal') parts.push(`Modo: ${it.printSettings.mode}`);
                        if (it.printSettings.rapport) parts.push(`Rapport: ${it.printSettings.rapport}`);
                        if (it.printSettings.finalWidthM) parts.push(`AnchoFinal: ${it.printSettings.finalWidthM}m`);
                        if (parts.length > 0) obsTecnicas += (obsTecnicas ? ' | ' : '') + parts.join(', ');
                    }

                    return {
                        fileName: it.fileName,
                        fileBackName: it.fileBackName,
                        // Clave única por archivo (la manda el portal). Con dos archivos de igual
                        // nombre, el match de subida por nombre subía el mismo archivo dos veces.
                        fileKey: it.fileKey || null,
                        fileBackKey: it.fileBackKey || null,
                        copies: it.cantidad || 1,
                        note: it.nota,
                        width: it.width,
                        height: it.height,
                        observaciones: obsTecnicas,
                        widthBack: it.widthBack,
                        heightBack: it.heightBack,
                        observacionesBack: it.observacionesBack,
                        sinDPI: it.sinDPI,
                        sinDPIBack: it.sinDPIBack,
                        // ECOUV: terminaciones elegidas para ESTE archivo [{terminacionId, cantidad}]
                        terminaciones: Array.isArray(it.terminaciones) ? it.terminaciones : []
                    };
                });

                // 2. Archivos Referencia (Bocetos, Logos, Extras, Info Pedido)
                // Son todos los que NO son de producción.
                const ordenReferencias = rawFiles.filter(f => !prodTypes.includes(f.tipo));

                // Extracción Robusta de CodArticulo y CodStock (puede venir en raiz de cabecera o dentro de material object)
                let finalCodArt = cabecera.codArticulo || cabecera.codArt;
                let finalCodStock = cabecera.codStock;

                if (!finalCodArt && cabecera.material && typeof cabecera.material === 'object') {
                    finalCodArt = cabecera.material.codArt || cabecera.material.codArticulo;
                    finalCodStock = cabecera.material.codStock;
                }

                // Extracción robusta de ID de producto
                let finalProIdProducto = cabecera.proIdProducto || cabecera.ProIdProducto;
                let finalIdProductoReact = cabecera.idProductoReact || cabecera.idProducto;

                if (cabecera.material && typeof cabecera.material === 'object') {
                    if (!finalProIdProducto) finalProIdProducto = cabecera.material.proIdProducto || cabecera.material.ProIdProducto || cabecera.material.id;
                    if (!finalIdProductoReact) finalIdProductoReact = cabecera.material.idProductoReact || cabecera.material.idProducto || cabecera.material.id;
                }

                // [PRENDAS] Estampado DTF vs Estampado TPU: el front manda SIEMPRE el mismo
                // artículo genérico (antes "Estampado (Servicio)", CodArt '110') para las dos
                // ramas de Estampado — nunca tuvo precio base cargado. Ahora que existen los
                // dos artículos separados (110=Estampado DTF, 157=Estampado TPU, cada uno con
                // su propio precio), se elige acá según a qué orden está encadenada esta
                // Estampado (srv.chainedAfterAreaId ya viaja con 'DF' o 'TPU'). Se pisa también
                // ProIdProducto para que la resolución de más abajo (mapArtByProId, que prioriza
                // ProIdProducto sobre CodArticulo) no la vuelva a pisar con el valor viejo.
                if (areaID === 'EST' && srv.chainedAfterAreaId) {
                    const cadenaEst = String(srv.chainedAfterAreaId).trim().toUpperCase();
                    if (cadenaEst === 'DF') { finalCodArt = '110'; finalProIdProducto = 29; }
                    else if (cadenaEst === 'TPU') { finalCodArt = '157'; finalProIdProducto = 418; }
                }

                // [PRENDAS] Orden madre PRO de una prenda personalizada (sin catálogo):
                // artículo genérico PPERS resuelto arriba. Sin CodArt/CodStock a propósito
                // (igual que el producto terminado: el precio sale de PreciosBase, $0).
                if (areaID === 'PRO' && srv.esPrendaPersonalizada && proIdPrendaPersonalizada) {
                    finalProIdProducto = proIdPrendaPersonalizada;
                }

                // Construir Nota con Metadatos Técnicos
                let serviceNote = srv.notas || '';
                let techInfo = '';

                if (areaID === 'TWC') {
                    // [CORTE] Una sola línea y en cristiano: qué tela llega y de dónde. Antes la orden salía con
                    // "Corte habilitado. Molde: SUBLIMACION. Tela: TELA SUBLIMADA EN USER." y además
                    // "[DATOS TÉCNICOS] Molde: SUBLIMACION, Tela: TELA SUBLIMADA EN USER": lo mismo dos veces.
                    const fo = String(srv.metadata?.fabricOrigin || '').toUpperCase();
                    const mt = String(srv.metadata?.moldType || '').toUpperCase();
                    const principalArea = String((req.body.servicios || []).find(x => x.esPrincipal)?.areaId || serviceId || '').toUpperCase();
                    let tela = /CLIENTE/.test(fo)
                        ? `Tela del cliente${srv.metadata?.clientFabricName ? ': ' + srv.metadata.clientFabricName : ''}`
                        : (principalArea === 'DIRECTA' || principalArea === 'DIRECTA_320') ? 'Tela impresa en USER (Impresión directa)'
                        : principalArea === 'ECOUV' ? 'Material impreso en USER (Gran formato)'
                        : 'Tela sublimada en USER';
                    if (/MOLDES CLIENTES/.test(mt)) tela += ' · Moldes del cliente';
                    const propia = String(srv.notas || '').replace(/^Corte habilitado\.?[^\n]*/i, '').trim();
                    serviceNote = [tela, propia].filter(Boolean).join('\n');
                    techInfo = tela;
                } else if (srv.metadata) {
                    const metaParts = [];
                    if (srv.metadata.prendas) metaParts.push(`Prendas: ${srv.metadata.prendas}`);
                    if (srv.metadata.estampadosPorPrenda) metaParts.push(`Bajadas: ${srv.metadata.estampadosPorPrenda}`); // User asked for 'bajadas'
                    if (srv.metadata.origen) metaParts.push(`Origen: ${srv.metadata.origen}`);
                    if (srv.metadata.moldType) metaParts.push(`Molde: ${srv.metadata.moldType}`);
                    if (srv.metadata.fabricOrigin) metaParts.push(`Tela: ${srv.metadata.fabricOrigin}`);
                    if (srv.metadata.medidaTpu) metaParts.push(`Medida: ${srv.metadata.medidaTpu}`);   // [TPU COMO PORTAL]

                    if (metaParts.length > 0) {
                        techInfo = metaParts.join(', '); // Format: "Prendas: 45, Bajadas: 3, Origen: Cliente"
                        serviceNote = (serviceNote ? serviceNote + '\n' : '') + `[DATOS TÉCNICOS] ${techInfo}`;
                    }
                }

                pendingOrderExecutions.push({
                    areaID: areaID,
                    material: cabecera.material?.name || cabecera.material || 'Estándar',
                    variante: cabecera.variante || 'N/A',
                    codArticulo: finalCodArt,
                    codStock: finalCodStock,
                    proIdProducto: finalProIdProducto,
                    idProductoReact: finalIdProductoReact,
                    items: ordenItems,
                    referencias: ordenReferencias,
                    isExtra: !srv.esPrincipal,
                    extraOriginId: srv.areaId,
                    // TPU: Magnitud = cantidad pedida (el ítem no trae archivo y el recálculo por
                    // archivos nunca la fijaba → quedaba "0 U"). Espejo del fix en webOrdersController.
                    // [PRENDAS] Mismo problema con la prenda comprada por WMS: tampoco trae archivo,
                    // así que sin esto quedaba en Magnitud=0 (y "confirmar retiro" descontaría 1
                    // unidad del WMS externo en vez de la cantidad real comprada).
                    // [UNA ORDEN POR ARCHIVO] Bordado partido por archivo: cada orden lleva SUS prendas (editable
                    // por archivo en la página). Con Magnitud 0 tomaría las de la PRO madre (todas).
                    magnitudInicial: (() => {
                        if (areaID === 'EMB') {
                            const p = parseInt(srv.metadata?.prendas, 10);
                            return Number.isFinite(p) && p > 0 ? p : (prendasPedido || 0);
                        }
                        if (areaID === 'EST') {
                            const p = parseInt(srv.metadata?.prendas, 10) || prendasPedido || 0;
                            const estPorPrenda = parseInt(srv.metadata?.estampadosPorPrenda, 10) || 1;
                            return p * estPorPrenda;
                        }
                        if (srv.porArchivo && parseInt(srv.metadata?.prendas) > 0) return parseInt(srv.metadata.prendas);
                        if ((serviceId === 'tpu' && srv.esPrincipal) || srv.esProductoComprado || srv.esProductoFabricado) {
                            return (srv.items || []).reduce((s, it) => s + (parseInt(it.cantidad) || 0), 0);
                        }
                        if (['TWC', 'TWT'].includes(areaID)) return prendasPedido || 0;
                        return 0;
                    })(),
                    notaAdicional: serviceNote, // Nota completa para la Orden
                    techInfo: techInfo, // Info técnica limpia para ServiciosExtraOrden
                    metadata: srv.metadata || {},   // [TPU COMO PORTAL] prendas × bajadas para la cantidad del TPU sin archivo
                    // [PRENDAS] Estampado fusionado con DTF/TPU: si esta Orden depende de que
                    // OTRA termine primero (ej. Estampado espera a su DTF/TPU), acá viaja el
                    // AreaID de esa Orden — se resuelve a OrdenID real más abajo, en el loop.
                    chainedAfterAreaId: srv.chainedAfterAreaId || null,
                    // [UNA ORDEN POR ARCHIVO] TPU/Bordado con varios archivos salen como varias órdenes de la
                    // misma área: chainKey identifica a cada una y chainedAfterKey dice a cuál de ellas se
                    // encadena su Estampado (sin esto todos los Estampados quedaban colgados del primer TPU).
                    chainKey: srv.chainKey || null,
                    chainedAfterKey: srv.chainedAfterKey || null,
                    // [PRENDAS] "Comprar y personalizar": esta línea es la prenda comprada por
                    // WMS (no un servicio de decoración) — dispara el gate ESPERANDO_RETIRO_WMS
                    // y guarda su wms_variante_id para poder descontar el stock correcto.
                    esProductoComprado: !!srv.esProductoComprado,
                    wmsVarianteId: cabecera.wmsVarianteId || null,
                    // [VENTA x ITEM] "Comprar y personalizar" con servicios POR ARTÍCULO del
                    // carrito: agrupa las órdenes de un mismo artículo (el Short con SU bordado,
                    // el Gorro con SU estampado) igual que comboItemId agrupa un componente de
                    // combo. Vale el wms_variante_id, que el carrito ya garantiza único por
                    // línea (addItemToCart suma cantidades sobre la línea existente).
                    //
                    // Es un campo aparte de comboItemId a propósito: comboItemId se PERSISTE en
                    // Ordenes.ComboItemID, y ahí "PRO con ComboItemID NULL" significa "orden
                    // madre del pedido" (quotationController lo usa para el filtro del área PRO
                    // y para el marcador de modo de facturación). La PRO de cada artículo del
                    // carrito SIGUE siendo orden madre, así que no puede llevar ComboItemID:
                    // agrupa solo en memoria, para rutear. Quienes sí lo persisten son sus
                    // servicios y su ancla de retiro, que nunca son orden madre.
                    grupoItemId: srv.grupoItemId || null,
                    // [PRENDA CLIENTE] Línea de prendas que el cliente entregó en Recepción y
                    // que esta orden va a trabajar. Análogo exacto de BobinaTelaID en tela de
                    // cliente: es lo que descuenta el saldo (vw_PrendasClienteDisponibles resta
                    // lo tomado por las órdenes vivas) y lo que deja cumplir solo el requisito
                    // PRENDA cuando el bulto llega al área.
                    prendaClienteId: srv.prendaClienteId || null,
                    // [VENTA UNA LÍNEA] Artículos del carrito de "Comprar y personalizar" que
                    // cobra ESTA orden PRO (la única del pedido). Se guardan como líneas extra
                    // de la orden — ver el insert después de crearla.
                    articulosVenta: Array.isArray(srv.articulosVenta) && srv.articulosVenta.length ? srv.articulosVenta : null,
                    // [PRENDAS] "Fabricar a Medida" con Producto Terminado: análogo a
                    // esProductoComprado, pero la prenda NO sale de un depósito WMS — se arma
                    // acá mismo (Sublimación → Corte → Costura). No dispara el gate de retiro
                    // WMS; en cambio, esta orden PRO queda encadenada a Costura (o Corte si no
                    // hay Costura) y nace recién cuando esa termina.
                    esProductoFabricado: !!srv.esProductoFabricado,
                    // [COMBOS] Componente del combo al que pertenece esta orden (Gorro/Short...).
                    // null = producto simple, comportamiento idéntico al de siempre en todo lo
                    // que sigue (sufijo de CodigoOrden, ruteo de ProximoServicio, encadenado).
                    comboItemId: srv.comboItemId || null,
                });
            });

            // CASO 2: ESTRUCTURA VIEJA (Lineas / Items Planos)
        } else if (lineas && lineas.length > 0) {
            lineas.forEach(linea => {
                const cabecera = linea.cabecera || {};
                const sublineas = linea.sublineas || [];

                let finalProIdProducto = cabecera.proIdProducto || cabecera.ProIdProducto;
                if (cabecera.material && typeof cabecera.material === 'object') {
                    if (!finalProIdProducto) finalProIdProducto = cabecera.material.proIdProducto || cabecera.material.ProIdProducto || cabecera.material.id;
                }

                pendingOrderExecutions.push({
                    areaID: mainAreaID,
                    material: cabecera.material,
                    variante: cabecera.variante,
                    codArticulo: cabecera.codArticulo,
                    codStock: cabecera.codStock,
                    proIdProducto: finalProIdProducto,
                    idProductoReact: cabecera.idProductoReact || cabecera.material?.id,
                    items: sublineas.map(sl => ({
                        fileName: sl.archivoPrincipal?.name,
                        fileBackName: sl.archivoDorso?.name,
                        copies: sl.cantidad,
                        note: sl.nota,
                        width: sl.width,
                        height: sl.height,
                        widthBack: sl.widthBack,
                        heightBack: sl.heightBack,
                        observaciones: sl.archivoPrincipal?.observaciones || '',
                        observacionesBack: sl.archivoDorso?.observaciones || '',
                        sinDPI: sl.archivoPrincipal?.sinDPI,
                        sinDPIBack: sl.archivoDorso?.sinDPI
                    })),
                    referencias: [], // Legacy no maneja refs por linea asi
                    isExtra: false,
                    notaAdicional: '',
                    techInfo: ''
                });
            });
        } else {
            // Lógica de compatibilidad items plano (Legacy total)
            const groupsByMat = {};
            for (const item of items) {
                const matObj = item.material || (configuracion?.materialBase) || { name: 'Estándar' };
                const matWeb = matObj.name || matObj;
                const varWeb = (configuracion?.varianteBase) || req.body.subtype || 'Estándar';
                const key = `${matWeb}|${varWeb}`.toUpperCase();
                if (!groupsByMat[key]) {
                    groupsByMat[key] = {
                        areaID: mainAreaID,
                        material: matWeb,
                        variante: varWeb,
                        codArticulo: matObj.codArt,
                        codStock: matObj.codStock,
                        proIdProducto: matObj.proIdProducto || matObj.id,
                        idProductoReact: matObj.id,
                        items: [],
                        isExtra: false,
                        referencias: [],
                        notaAdicional: '',
                        techInfo: ''
                    };
                }
                groupsByMat[key].items.push({
                    fileName: item.file?.name,
                    fileBackName: item.fileBack?.name,
                    copies: item.copies,
                    note: item.note,
                    width: item.width,
                    height: item.height
                });
            }
            Object.values(groupsByMat).forEach(g => pendingOrderExecutions.push(g));
        }

        // --- (Agregar Áreas Extras) ---
        if (selectedComplementary) {
            Object.entries(selectedComplementary).forEach(([extraId, val]) => {
                const activo = val.activo || val.active;
                if (!activo) return;
                const extraArea = EXTRA_ID_TO_AREA[extraId.toUpperCase()] || extraId.toUpperCase();
                const cabecera = val.cabecera || val.header;

                let areaMaterial = cabecera?.material?.name || (configuracion?.materialBase?.name || 'Estándar');
                let areaVariante = cabecera?.variante || 'N/A';

                let extraCodArt = null;
                let extraCodStock = null;
                let extraIdProd = null;
                let extraProIdProd = null;
                let magnitudInicial = 0;

                if (extraArea === 'TWT' || extraId.toUpperCase() === 'COSTURA') {
                    areaMaterial = 'Costura';
                    areaVariante = 'Costura';
                    extraCodArt = '115';
                    extraCodStock = '1.1.7.1';
                    extraProIdProd = 36;
                    extraIdProd = 219;
                    magnitudInicial = parseInt(val.cantidad || val.quantity || cabecera?.cantidad || 0);
                } else if (extraArea === 'TWC' || extraId.toUpperCase() === 'LASER' || extraId.toUpperCase() === 'CORTE') {
                    areaMaterial = 'Corte Laser por prenda';
                    areaVariante = 'Corte Laser';
                    extraCodArt = '1375';
                    extraCodStock = '1.1.6.1';
                    extraProIdProd = 90;
                    extraIdProd = 253;
                    magnitudInicial = parseInt(val.cantidad || val.quantity || cabecera?.cantidad || 0);
                } else if (extraArea === 'EMB' || extraId.toUpperCase() === 'BORDADO') {
                    areaMaterial = 'Bordado';
                    areaVariante = 'Bordado';
                    extraCodArt = '1567';
                    extraCodStock = '1.1.9.1';
                    extraProIdProd = 434;
                    extraIdProd = 65;
                    magnitudInicial = parseInt(val.cantidad || val.quantity || cabecera?.cantidad || 0);
                }

                let serviceSpec = '';
                if (val.metadata?.prendas) serviceSpec += `Prendas: ${val.metadata.prendas}`;
                if (val.metadata?.material) serviceSpec += (serviceSpec ? ', ' : '') + `Mat: ${val.metadata.material}`;

                const finalExtraNote = [val.notas, serviceSpec].filter(x => x).join(' | ');

                pendingOrderExecutions.push({
                    areaID: extraArea,
                    material: areaMaterial,
                    variante: areaVariante,
                    codArticulo: extraCodArt,
                    codStock: extraCodStock,
                    idProductoReact: extraIdProd,
                    proIdProducto: extraProIdProd,
                    isExtra: true,
                    extraOriginId: extraId,
                    magnitudInicial: magnitudInicial,
                    items: [],
                    referencias: [],
                    notaAdicional: finalExtraNote,
                    techInfo: serviceSpec
                });
            });
        }

        // --- 5B. ORDENAR EJECUCIONES POR PRIORIDAD (Lógica Homogénea con Sync) ---
        // Debug Log
        logger.info("--- DEBUG SORTING ---");
        logger.info("Mapa Areas Numero:", JSON.stringify(mapaAreasNumero));
        pendingOrderExecutions.forEach(e => {
            logger.info(`Area: ${e.areaID} - Prioridad: ${mapaAreasNumero[e.areaID] || 999}`);
        });

        // Esto asegura que la numeración (1/N, 2/N) respete el flujo real del proceso.
        pendingOrderExecutions.sort((a, b) => {
            // Normalizar keys para asegurar match (toUpperCase ya se hizo al crear areaID pero doble check)
            const idA = (a.areaID || '').toUpperCase().trim();
            const idB = (b.areaID || '').toUpperCase().trim();

            // Sync logic usa 'Numero' de ConfigMapeoERP.
            // Asegurar que mapaAreasNumero tenga keys en Upper.
            const pA = mapaAreasNumero[idA] !== undefined ? mapaAreasNumero[idA] : 999;
            const pB = mapaAreasNumero[idB] !== undefined ? mapaAreasNumero[idB] : 999;

            return pA - pB;
        });

        // [REQUISITOS] Encadenar Corte/Costura a su predecesor real en la cadena "Fabricar a
        // Medida" (Sublimación→Corte→Costura→...) — mismo campo chainedAfterAreaId que ya arma
        // el frontend para Estampado (PrendaOrderForm.jsx, srv.chainedAfterAreaId), pero acá no
        // llega armado: se calcula server-side, ANTES del sort de abajo (que necesita conocer
        // chainedAfterAreaId para insertar cada orden después de la que la libera). El
        // requisito bloqueante de cada una (TELA en TWC, CORTES en TWT) queda pendiente hasta
        // que la anterior de la cadena llegue físicamente — lo resuelve el check-in extendido
        // en logisticsController.js (match por LiberaCuandoOrdenID).
        pendingOrderExecutions.forEach(exec => {
            if (exec.chainedAfterAreaId) return; // ya viene armado del frontend (Estampado)
            const areaId = (exec.areaID || '').toUpperCase();
            if (areaId !== 'TWC' && areaId !== 'TWT') return;
            const lote = exec.comboItemId
                ? pendingOrderExecutions.filter(e => e.comboItemId === exec.comboItemId)
                : pendingOrderExecutions;
            const activas = new Set(lote.map(e => (e.areaID || '').toUpperCase()));
            const principal = AREAS_PRINCIPAL_IMPRESION.find(a => activas.has(a));   // SB, DIRECTA o ECOUV (F1)
            if (areaId === 'TWC' && principal) {
                exec.chainedAfterAreaId = principal;
            } else if (areaId === 'TWT') {
                if (activas.has('TWC')) exec.chainedAfterAreaId = 'TWC';
                else if (principal) exec.chainedAfterAreaId = principal;
            }
        });

        // [PRENDAS] Las Ordenes encadenadas (ej. Estampado esperando a su DTF/TPU) tienen que
        // insertarse DESPUÉS de la Orden de la que dependen, para poder guardar su OrdenID real
        // (ver más abajo, "insertedOrdenIdByAreaId"). Sort estable: no reordena nada más.
        pendingOrderExecutions.sort((a, b) => (a.chainedAfterAreaId ? 1 : 0) - (b.chainedAfterAreaId ? 1 : 0));

        // --- LIMPIEZA DE DATOS (FIX IDPRODUCTOREACT) ---
        // Asegurar que CodArticulo no tenga espacios antes de buscar IDReact
        pendingOrderExecutions.forEach(exec => {
            if (exec.codArticulo) {
                exec.codArticulo = String(exec.codArticulo).trim();
            }
        });

        // Buscamos IDProdReact y ProIdProducto en la tabla Articulos usando ProIdProducto, IDProdReact o CodArticulo
        const proIdCodes = [];
        const idReactCodes = [];
        const codArtCodes = [];
        pendingOrderExecutions.forEach(e => {
            if (e.proIdProducto) proIdCodes.push(String(e.proIdProducto).trim());
            if (e.idProductoReact) idReactCodes.push(String(e.idProductoReact).trim());
            if (e.codArticulo) codArtCodes.push(String(e.codArticulo).trim());
        });
        const uniqueProIds = [...new Set(proIdCodes)].filter(Boolean);
        const uniqueIdReacts = [...new Set(idReactCodes)].filter(Boolean);
        const uniqueCodArts = [...new Set(codArtCodes)].filter(Boolean);

        const mapArtByProId = {};
        const mapArtByIdReact = {};
        const mapArtByCodArt = {};

        if (uniqueProIds.length > 0 || uniqueIdReacts.length > 0 || uniqueCodArts.length > 0) {
            try {
                const request = pool.request();
                const clauses = [];

                uniqueProIds.forEach((id, i) => {
                    request.input(`proId${i}`, sql.Int, parseInt(id));
                    clauses.push(`(ProIdProducto = @proId${i})`);
                });

                uniqueIdReacts.forEach((id, i) => {
                    request.input(`idReact${i}`, sql.Int, parseInt(id));
                    clauses.push(`(IDProdReact = @idReact${i})`);
                });

                uniqueCodArts.forEach((code, i) => {
                    request.input(`codArt${i}`, sql.VarChar(50), code);
                    clauses.push(`(LTRIM(RTRIM(CodArticulo)) = @codArt${i})`);
                });

                const whereClause = clauses.join(' OR ');
                const queryStr = `SELECT IDProdReact, CodArticulo, ProIdProducto, CodStock FROM Articulos WHERE ${whereClause}`;

                const artRes = await request.query(queryStr);

                artRes.recordset.forEach(r => {
                    const info = { idReact: r.IDProdReact, proId: r.ProIdProducto, codArt: r.CodArticulo ? r.CodArticulo.trim() : null, codStock: r.CodStock ? r.CodStock.trim() : null };
                    if (r.ProIdProducto !== null && r.ProIdProducto !== undefined) {
                        mapArtByProId[String(r.ProIdProducto).trim()] = info;
                    }
                    if (r.IDProdReact !== null && r.IDProdReact !== undefined) {
                        mapArtByIdReact[String(r.IDProdReact).trim()] = info;
                    }
                    if (r.CodArticulo !== null && r.CodArticulo !== undefined) {
                        mapArtByCodArt[r.CodArticulo.trim().toUpperCase()] = info;
                    }
                });

                // Asignar IDs a las ejecuciones
                pendingOrderExecutions.forEach(exec => {
                    let info = null;
                    if (exec.proIdProducto) {
                        info = mapArtByProId[String(exec.proIdProducto).trim()];
                    }
                    if (!info && exec.idProductoReact) {
                        info = mapArtByIdReact[String(exec.idProductoReact).trim()];
                    }
                    if (!info && exec.codArticulo) {
                        info = mapArtByCodArt[String(exec.codArticulo).trim().toUpperCase()];
                    }

                    if (info) {
                        exec.idProductoReact = info.idReact || exec.idProductoReact;
                        exec.proIdProducto = info.proId || exec.proIdProducto;
                        exec.codArticulo = info.codArt || exec.codArticulo;
                        if (info.codStock && !exec.codStock) {
                            exec.codStock = info.codStock;
                        }
                    }
                });

            } catch (lookupErr) {
                logger.warn("⚠️ No se pudo resolver IdProductoReact/ProIdProducto desde Articulos:", lookupErr.message);
            }
        }

        // --- CARGAR MAPEO DE PREFIJOS ---
        const configRes = await pool.request().query("SELECT AreaID_Interno, CodOrden FROM ConfigMapeoERP");
        const areaPrefixMap = {};
        configRes.recordset.forEach(r => {
            if (r.AreaID_Interno && r.CodOrden) {
                areaPrefixMap[r.AreaID_Interno.trim().toUpperCase()] = r.CodOrden.trim().toUpperCase();
            }
        });

        // --- GUARD: NO crear órdenes de impresión SIN arte ---
        // Las órdenes que miden por metros (UM ≠ 'u' → sublimación, DTF, ECOUV…) DEBEN traer al menos un
        // archivo de arte; sin él nacen con Magnitud 0 y hay que cancelarlas a mano. Última línea de
        // defensa (por si el form deja pasar o llega un payload directo). Misma regla que la retención del
        // sync ERP. Los servicios por unidad (costura, corte, TPU-boceto) miden en 'u' → quedan exentos.
        const ordenSinArte = pendingOrderExecutions.find(exec => {
            if (exec.isExtra) return false;
            // [PRENDAS] La prenda comprada por WMS es un producto físico, no algo que se
            // imprime — nunca requiere arte, aunque su StockArt todavía no esté marcado
            // PRODUCTO_TERMINADO (ese chequeo recién corre más abajo, dentro de la
            // transacción). No depender de esa detección acá para no rechazarla de más.
            if (exec.esProductoComprado) return false;
            const um = (mapaAreasUM[exec.areaID] || 'u').toLowerCase();
            if (um === 'u') return false; // por unidad → no requiere arte del cliente
            return !(exec.items || []).some(it => it.fileName || it.fileBackName);
        });
        if (ordenSinArte) {
            logger.warn(`⛔ [WebOrder] Pedido rechazado: servicio de impresión ${ordenSinArte.areaID} sin archivo de arte.`);
            return res.status(400).json({
                error: `El servicio de impresión (${ordenSinArte.areaID}) necesita al menos un archivo de arte. Subí el arte a imprimir antes de confirmar el pedido.`
            });
        }

        // [PRENDAS] ¿Este lote incluye una prenda comprada (producto terminado)? Si es así,
        // Bordado/DTF/TPU (y la propia prenda) tienen que esperar a que el almacenero
        // confirme el retiro físico del depósito WMS antes de poder trabajarse — ver el
        // gate más abajo ("ESPERANDO_RETIRO_WMS"). Chequeo liviano, fuera de la transacción.
        let hayProductoTerminadoEnLote = false;
        {
            const codStocksUnicos = [...new Set(pendingOrderExecutions.map(e => e.codStock).filter(Boolean).map(s => String(s).trim()))];
            if (codStocksUnicos.length > 0) {
                try {
                    const req2 = pool.request();
                    const clauses2 = codStocksUnicos.map((cs, i) => {
                        req2.input(`cs${i}`, sql.VarChar, cs);
                        return `LTRIM(RTRIM(CodStock)) = @cs${i}`;
                    });
                    // PRODUCTO_LOCAL (12-ago) frena igual que PRODUCTO_TERMINADO: también
                    // hay que esperar el retiro físico del depósito WMS antes de decorar.
                    const tipoStockRes = await req2.query(`SELECT TipoStock FROM StockArt WHERE (${clauses2.join(' OR ')}) AND TipoStock IN ('PRODUCTO_TERMINADO', 'PRODUCTO_LOCAL')`);
                    hayProductoTerminadoEnLote = tipoStockRes.recordset.length > 0;
                } catch (e) {
                    logger.warn('[Prendas] No se pudo chequear PRODUCTO_TERMINADO del lote:', e.message);
                }
            }
        }

        // --- 6. TRANSACCIÓN DB ---
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const filesToUpload = [];
            const generatedOrders = [];
            const generatedIDs = [];
            // [BORDADO] Órdenes con ficha de diseño: después del commit se les genera la matriz
            // automática (borrador de Ink/Stitch, ver services/bordadoMatrizService.js).
            const ordenesMatrizAuto = [];
            const timestamp = Date.now();
            let telaDescontada = false; // TELA CLIENTE: garantiza UN solo descuento por pedido
            // [PRENDAS] OrdenID real de cada área ya insertada en ESTE loop — permite que una
            // Orden encadenada (ej. Estampado) guarde el OrdenID real de aquella de la que
            // depende (ej. su DTF/TPU), aunque esta última se haya creado unos pasos antes.
            const insertedOrdenIdByAreaId = {};
            // [UNA ORDEN POR ARCHIVO] OrdenID por chainKey (una por archivo de TPU/Bordado)
            const insertedOrdenIdByChainKey = {};
            // [COMBOS] Clave compuesta cuando la orden pertenece a un componente de combo —
            // sin esto, dos componentes con la MISMA área (ej. dos Bordados) se pisarían el
            // OrdenID entre sí y un Estampado encadenaría con el DTF/TPU del OTRO componente.
            // Sin comboItemId (caso de siempre), la clave es igual a la de hoy (solo areaId).
            // La clave tiene que separar por GRUPO, no solo por combo: si dos grupos del
            // mismo pedido tienen DTF (dos prendas del cliente, cada una con el suyo), sin el
            // grupo las dos claves serían "DF" y el Estampado de la segunda quedaría
            // encadenado al DTF de la primera.
            const claveOrdenArea = (grupoId, areaId) => grupoId ? `${grupoId}|${areaId}` : areaId;
            const grupoDeExec = (e) => e.comboItemId || e.grupoItemId || null;

            for (let idx = 0; idx < pendingOrderExecutions.length; idx++) {
                const exec = pendingOrderExecutions[idx];
                let docNumber = erpDocNumber;

                // [PRENDAS] Si el mismo ÁREA aparece más de una vez en el lote (ej. DTF y TPU
                // activos a la vez generan 2 EST; un COMBO con dos componentes bordados genera
                // 2 EMB), sin esto compartirían el MISMO CodigoOrden (EST-10994),
                // indistinguibles en cualquier pantalla/listado. Generalizado a cualquier área
                // (antes solo cubría SB y EST) para que los combos no repitan código tampoco.
                const fisicasMismaArea = pendingOrderExecutions.filter(e => e.areaID === exec.areaID);
                if (fisicasMismaArea.length > 1) {
                    const indexArea = fisicasMismaArea.findIndex(e => e === exec) + 1;
                    docNumber = `${erpDocNumber} (${indexArea}/${fisicasMismaArea.length})`;
                }

                const areaPrefix = areaPrefixMap[exec.areaID.toUpperCase()] || 'ORD';
                exec.codigoOrden = `${areaPrefix}-${docNumber}`;

                // helper sanitize ya está en scope global si lo moví bien, si no lo redefino por seguridad
                const sanitize = (str) => (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();
                // Quita todos los puntos del nombre de archivo excepto el de la extensión
                // Ej: "imagen.pedido.pdf" → "imagenpedido.pdf"
                const sanitizeFileName = (name) => {
                    if (!name) return name;
                    const lastDot = name.lastIndexOf('.');
                    if (lastDot <= 0) return name; // sin extensión o empieza con punto
                    const base = name.substring(0, lastDot).replace(/\./g, '');
                    const ext = name.substring(lastDot);
                    return base + ext;
                };

                // --- CALCULAR PRÓXIMO SERVICIO ---
                let proximoServicio = 'DEPOSITO';

                // [PRENDAS] "Comprar y personalizar": el orden por el que se pushearon los
                // servicios (según qué botones tocó el vendedor) NO refleja la dependencia
                // física real, así que "siguiente en el array" da rutas incorrectas. Acá NO es
                // una cadena lineal — son ramas independientes que convergen en Estampado:
                //   - PRO (la prenda física) va a Bordado si está activo (Bordado trabaja SOBRE
                //     la prenda); si no hay Bordado pero sí DTF/TPU, la prenda va directo a
                //     Estampado (ahí se prensa el transfer); si no hay ninguno de los dos, listo.
                //   - Bordado, una vez terminada la prenda, va a Estampado si hay DTF/TPU
                //     esperando (si no, ya está terminada).
                //   - DTF y TPU NO dependen entre sí — cada uno imprime SU PROPIO transfer
                //     (no toca la prenda) y va directo a SU Estampado encadenado, nunca al otro.
                //   - Estampado siempre termina en Depósito.
                // [COMBOS] areasActivas se escopa por comboItemId — el Bordado del Gorro no
                // debe ver el DTF/Estampado del Short (y viceversa) al decidir su propio
                // próximo paso. esProductoFabricadoEnLote/hayOrdenMadrePro, en cambio, son
                // GLOBALES a todo el lote (FASE 3): dentro del NoDocERP del pedido de un combo
                // ya no conviven líneas "esProductoComprado" (el retiro de stock ahora vive en
                // su propia venta VEN-, aparte) — solo la PRO de precio (esProductoFabricado) y
                // los servicios de decoración, igual que un producto simple. Sin comboItemId
                // (caso de siempre), el filtro de areasActivas es un no-op.
                // [VENTA x ITEM] El grupo de una orden es su componente de combo (comboItemId)
                // o, en "Comprar y personalizar" con servicios por artículo, el artículo del
                // carrito (grupoItemId). Mismo efecto: el Bordado del Gorro no ve el Estampado
                // del Short al decidir su próximo paso. Sin ninguno de los dos (caso de
                // siempre), el filtro es un no-op.
                const grupoExec = grupoDeExec(exec);
                const loteDelComponente = grupoExec
                    ? pendingOrderExecutions.filter(e => String(grupoDeExec(e)) === String(grupoExec))
                    : pendingOrderExecutions;
                const esProductoFabricadoEnLote = pendingOrderExecutions.some(e => e.esProductoFabricado);
                const hayOrdenMadrePro = pendingOrderExecutions.some(e => e.esProductoComprado || e.esProductoFabricado);
                if (hayOrdenMadrePro) {
                    const areasActivas = new Set(loteDelComponente.map(e => e.areaID));
                    const hayEstampado = areasActivas.has('EST'); // implica DTF y/o TPU activos
                    if (esProductoFabricadoEnLote) {
                        // [PRENDAS] "Fabricar a Medida" con Producto Terminado: PRO NO es un
                        // paso físico — nace junto con todo lo demás (sin gate) y es solo el
                        // "pilar" que agrupa el pedido para precio/factura/aviso, igual que la
                        // hermana TERMINAC de ECOUV. La prenda física la arma la cadena real:
                        // Sublimación → Corte → Costura → Bordado → Estampado → Depósito (Costura
                        // hace de "prenda lista", el mismo rol que cumplía PRO en "Comprar y
                        // personalizar"). Por ahora la decoración siempre es DESPUÉS de armar la
                        // prenda — a futuro se podrá elegir antes/después.
                        switch (exec.areaID) {
                            case 'SB':
                            case 'DIRECTA':   // F1: misma cadena que sublimación cuando es la producción principal
                            case 'ECOUV':
                                proximoServicio = areasActivas.has('TWC') ? 'TWC'
                                    : (areasActivas.has('TWT') ? 'TWT'
                                        : (areasActivas.has('EMB') ? 'EMB' : (hayEstampado ? 'EST' : 'DEPOSITO')));
                                break;
                            case 'TWC':
                                proximoServicio = areasActivas.has('TWT') ? 'TWT'
                                    : (areasActivas.has('EMB') ? 'EMB' : (hayEstampado ? 'EST' : 'DEPOSITO'));
                                break;
                            case 'TWT':
                                // Termina de armar la prenda física — de acá en más, mismo destino
                                // que tenía PRO en "Comprar y personalizar".
                                proximoServicio = areasActivas.has('EMB') ? 'EMB' : (hayEstampado ? 'EST' : 'DEPOSITO');
                                break;
                            case 'PRO':
                                // No es un paso físico: no la usa nadie, pero le dejamos un valor
                                // no vacío por consistencia con el resto de las órdenes.
                                proximoServicio = 'DEPOSITO';
                                break;
                            case 'EMB':
                                proximoServicio = hayEstampado ? 'EST' : 'DEPOSITO';
                                break;
                            case 'DF':
                            case 'TPU':
                                proximoServicio = 'EST';
                                break;
                            case 'EST':
                            default:
                                proximoServicio = 'DEPOSITO';
                        }
                    } else {
                        switch (exec.areaID) {
                            case 'PRO':
                                // [VENTA x ITEM] Con servicios por artículo, la PRO del artículo
                                // ya NO es el paso físico: el recorrido real (ir a Bordado, a
                                // Estampado o derecho a Depósito) lo lleva su ancla de retiro
                                // VEN-, que se crea más abajo y calcula su propio destino. Acá
                                // la PRO queda solo como la línea de precio del artículo —
                                // mismo rol que la PRO de precio de un combo.
                                proximoServicio = exec.grupoItemId
                                    ? 'DEPOSITO'
                                    : (areasActivas.has('EMB') ? 'EMB' : (hayEstampado ? 'EST' : 'DEPOSITO'));
                                break;
                            case 'EMB':
                                proximoServicio = hayEstampado ? 'EST' : 'DEPOSITO';
                                break;
                            case 'DF':
                            case 'TPU':
                                proximoServicio = 'EST'; // siempre tiene su propia orden de Estampado encadenada
                                break;
                            case 'EST':
                            default:
                                proximoServicio = 'DEPOSITO';
                        }
                    }
                } else {
                    // Lógica secuencial homogénea de siempre (resto de flujos, sin orden madre PRO):
                    // al estar ordenado por prioridad, el próximo servicio es el siguiente en la lista.
                    for (let k = idx + 1; k < pendingOrderExecutions.length; k++) {
                        const nextExec = pendingOrderExecutions[k];
                        if (nextExec.areaID !== exec.areaID) {
                            proximoServicio = nextExec.areaID;
                            break;
                        }
                    }
                }

                // [PRENDAS] FASE 5 (generalizado): TODO pedido con orden madre PRO (Fabricar a
                // Medida o Comprar y Personalizar, con o sin combo) "muere" en PRO antes de ir a
                // Depósito — PRO es el único punto de salida hacia Depósito, así cada
                // área/componente se reúne ahí sin bloquear su propia salida ni esperar
                // "atascado" en producción. El remito final PRO→DEPOSITO se arma solo cuando el
                // pedido está completo en PRO (ver receiveDispatch en logisticsController.js).
                // El guard areaID!=='PRO' evita que la propia orden madre (cuando no tiene
                // ningún servicio de decoración activo) se apunte a sí misma. Sin orden madre
                // PRO, no-op.
                if (hayOrdenMadrePro && exec.areaID !== 'PRO' && proximoServicio === 'DEPOSITO') {
                    proximoServicio = 'PRO';
                }

                // Determinar UM + variante física (desde StockArt del CodStock elegido)
                let areaUM = mapaAreasUM[exec.areaID] || 'u';
                let varianteFinal = exec.variante;
                let esArmarAMedida = false;
                let esProductoTerminado = false;
                let notaMaterialImpresion = '';
                let tintaFinal = (exec.areaID === 'ECOUV' && tinta) ? String(tinta).trim() : null;
                if (exec.codStock) {
                    try {
                        const stUm = await new sql.Request(transaction)
                            .input('Stk', sql.VarChar, String(exec.codStock).trim())
                            .query("SELECT TOP 1 ISNULL(TipoStock, 'MATERIAL') AS TipoStock, LTRIM(RTRIM(Articulo)) AS VarianteStock FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = LTRIM(RTRIM(@Stk))");
                        const st = stUm.recordset[0];
                        if (st) {
                            // PRODUCTO TERMINADO o PRODUCTO_LOCAL (12-ago: sale del stock del
                            // local, mismo tratamiento de precio): se cuenta y precia por UNIDAD
                            // aunque el área trabaje en m2 (precio cerrado del artículo).
                            if (st.TipoStock === 'PRODUCTO_TERMINADO' || st.TipoStock === 'PRODUCTO_LOCAL') { areaUM = 'u'; esProductoTerminado = true; }

                            // ECOUV: la Variante de la ORDEN es SIEMPRE la clasificación física
                            // del material QUE SE IMPRIME (Lonas/Canvas/Vinilos...), para que
                            // producción agrupe lotes por material real.
                            if (exec.areaID === 'ECOUV' && st.VarianteStock) {
                                esArmarAMedida = /personalizad|medida/i.test(exec.variante || '');
                                varianteFinal = st.VarianteStock;

                                // Producto terminado: el material que se imprime sale de la FICHA
                                // (ProductosTerminados.MaterialCodArticulo), no del artículo producto.
                                if (st.TipoStock === 'PRODUCTO_TERMINADO' && exec.codArticulo) {
                                    const fichaRes = await new sql.Request(transaction)
                                        .input('Art', sql.VarChar, String(exec.codArticulo).trim())
                                        .query(`
                                            SELECT TOP 1 LTRIM(RTRIM(A.Descripcion)) AS MaterialImpresion,
                                                   LTRIM(RTRIM(S.Articulo)) AS VarianteMaterial,
                                                   LTRIM(RTRIM(P.Tinta)) AS TintaFicha
                                            FROM ProductosTerminados P
                                            INNER JOIN articulos A ON LTRIM(RTRIM(A.CodArticulo)) = LTRIM(RTRIM(P.MaterialCodArticulo))
                                            LEFT JOIN StockArt S ON LTRIM(RTRIM(S.CodStock)) = LTRIM(RTRIM(A.CodStock))
                                            WHERE LTRIM(RTRIM(P.CodArticulo)) = @Art
                                            ORDER BY CASE WHEN LTRIM(RTRIM(A.CodStock)) LIKE '1.1.3.%' THEN 0 ELSE 1 END
                                        `);
                                    const ficha = fichaRes.recordset[0];
                                    if (ficha) {
                                        if (ficha.VarianteMaterial) varianteFinal = ficha.VarianteMaterial;
                                        if (ficha.MaterialImpresion) notaMaterialImpresion = `[SE IMPRIME EN: ${ficha.MaterialImpresion}]`;
                                        // La tinta del producto terminado la define la FICHA (el cliente no la elige)
                                        tintaFinal = ficha.TintaFicha || null;
                                    }
                                }
                            }
                        }
                    } catch (_) { /* sin TipoStock/StockArt: se mantiene UM del área y variante original */ }
                }

                // [PRENDAS] Producto terminado: código de orden con prefijo PROD- en vez del
                // prefijo del área (SB-/EST-/...) — se distingue a simple vista una venta de
                // stock de un trabajo de impresión real, sin tocar el AreaID (misma cola/ruta).
                // Excepción: la orden PRO de "Fabricar a Medida" — aunque su CodStock resuelva
                // a un producto terminado (así se le calcula el precio), sigue siendo la orden
                // madre del pedido y tiene que llamarse PRO-, no PROD- (mismo criterio que la
                // PRO de "Comprar y personalizar", que tampoco lleva CodStock de producto
                // terminado en su cabecera).
                if (esProductoTerminado && !exec.esProductoFabricado) {
                    exec.codigoOrden = `PROD-${docNumber}`;
                }

                // [PRENDAS] Gate secuencial — "Comprar y personalizar": la prenda se retira
                // físicamente del depósito WMS antes de poder bordarse/imprimirse, y un DTF/TPU
                // impreso necesita pasar por Estampado antes de darse por terminado. Ninguna de
                // las dos cosas existe hoy fuera de este flujo: si el lote no trae un producto
                // terminado, esto no hace nada (null = comportamiento de siempre).
                let estadoDependenciaExec = null;
                let liberaCuandoOrdenIDExec = null;
                if (exec.chainedAfterAreaId) {
                    liberaCuandoOrdenIDExec = (exec.chainedAfterKey && insertedOrdenIdByChainKey[exec.chainedAfterKey])
                        || insertedOrdenIdByAreaId[claveOrdenArea(grupoDeExec(exec), exec.chainedAfterAreaId.toUpperCase())] || null;
                    // [REQUISITOS] 'ESPERANDO_IMPRESION' solo tiene sentido (y solo se libera)
                    // para Estampado esperando su DTF/TPU — el evento de release está
                    // hardcodeado a esas dos áreas en productionFileController.js. Para el
                    // encadenamiento nuevo (TWC←SB, TWT←TWC/SB) no hay ningún evento que saque
                    // este estado, así que queda en null (sin restricción extra) y el gate real
                    // lo da SQL_TRANSFER_LLEGO/LiberaCuandoOrdenID en embBoardController.js —
                    // genérico por área, no depende de un evento de "impresión terminada".
                    if (exec.areaID.toUpperCase() === 'EST') {
                        estadoDependenciaExec = 'ESPERANDO_IMPRESION';
                    }
                    if (!liberaCuandoOrdenIDExec) {
                        logger.warn(`[Prendas] ${exec.areaID} sin OrdenID de ${exec.chainedAfterAreaId} para encadenar (¿no se creó esa Orden?) — queda sin gate.`);
                        estadoDependenciaExec = null;
                    }
                } else if (exec.comboItemId && ['EMB', 'DF', 'TPU'].includes(exec.areaID.toUpperCase())) {
                    // [COMBOS] Servicio de decoración de un componente de combo: SIEMPRE espera
                    // a que se confirme el retiro — la venta VEN- de ESE componente, creada
                    // aparte (ver combosRetiro más abajo) — antes de arrancar. Independiente de
                    // esProductoFabricadoEnLote (la PRO de precio del combo SÍ es
                    // esProductoFabricado, pero sus componentes físicos igual se retiran del
                    // WMS). Se libera desde logisticaWmsController.confirmPreparation cuando se
                    // confirma esa VEN-, no desde confirmarRetiroWms (que es para "Comprar y
                    // Personalizar", donde el retiro vive en este mismo NoDocERP).
                    estadoDependenciaExec = 'ESPERANDO_RETIRO_WMS';
                } else if (exec.grupoItemId) {
                    // [VENTA x ITEM] PRO de un artículo del carrito de "Comprar y personalizar".
                    // Hay dos formas según si el artículo se personaliza o no, y el frontend las
                    // distingue mandando (o no) el wmsVarianteId en esta orden:
                    //
                    //  · SE PERSONALIZA → el retiro vive en su ancla VEN- (combosRetiro), igual
                    //    que un componente de combo. Esta PRO es solo la línea de precio: sin
                    //    wmsVarianteId y sin candado, porque no hay nada que ella espere.
                    //  · NO SE PERSONALIZA (una tinta, un insumo) → no hay ancla ni servicios:
                    //    esta PRO ES el retiro, con su wmsVarianteId, y espera a que el
                    //    almacenero lo confirme en Logística WMS ("Retiros de prendas").
                    //
                    // El candado se decide acá y NO por hayProductoTerminadoEnLote, que mira
                    // StockArt.TipoStock a través del CodStock: las líneas del carrito viajan
                    // sin CodStock (solo nombre, ProIdProducto y wms_variante_id), así que ese
                    // chequeo daba falso SIEMPRE y el artículo nacía sin candado — no aparecía
                    // en ninguna pantalla de retiro y su stock no lo descontaba nadie.
                    estadoDependenciaExec = exec.wmsVarianteId ? 'ESPERANDO_RETIRO_WMS' : null;
                } else if (hayProductoTerminadoEnLote && !esProductoFabricadoEnLote && (exec.esProductoComprado || esProductoTerminado || ['EMB', 'DF', 'TPU'].includes(exec.areaID.toUpperCase()))) {
                    estadoDependenciaExec = 'ESPERANDO_RETIRO_WMS';
                }

                // ID del producto (si lo tenemos en exec)
                const idProdReact = exec.idProductoReact || null;

                // Combinar Nota General + Nota Específica del Servicio (Metadatos)
                const combinedNote = [finalNote, exec.notaAdicional].filter(n => n && n.trim()).join(' | ');
                // La variante comercial "Personalizado (Armar a Medida)" y el material de
                // impresión del producto terminado viajan como marcas en la nota (la Variante
                // de la orden quedó reservada para la clasificación física del material).
                const notaOrden = [
                    esArmarAMedida ? '[ARMAR A MEDIDA]' : null,
                    notaMaterialImpresion || null,
                    combinedNote
                ].filter(Boolean).join(' ');

                const isPrinting = (exec.areaID || "").toUpperCase().match(/IMPRESION|GIG|SUBLIMACION|SB|DF|ECO|UV|DIRECTA/);
                const fechaEntradaSector = isPrinting ? new Date() : null;

                // INSERCIÓN DE ORDEN CON ESTADO 'Cargando...'
                const resOrder = await new sql.Request(transaction)
                    .input('AreaID', sql.VarChar(20), exec.areaID)
                    .input('Cliente', sql.NVarChar(200), nombreCliente)
                    .input('CodCliente', sql.Int, codCliente)
                    .input('IdClienteReact', sql.VarChar(50), idClienteReact ? idClienteReact.toString() : null)
                    .input('Desc', sql.NVarChar(300), jobName)
                    .input('Prio', sql.VarChar(20), finalUrgency)
                    .input('Mat', sql.VarChar(255), exec.material)
                    .input('Var', sql.VarChar(100), varianteFinal)
                    .input('Cod', sql.VarChar(50), exec.codigoOrden)
                    .input('ERP', sql.VarChar(50), erpDocNumber)
                    .input('Nota', sql.NVarChar(sql.MAX), notaOrden)
                    .input('Mag', sql.VarChar(50), String(exec.magnitudInicial || '0')) // Magnitud inicial (cero si no hay dato)
                    .input('Prox', sql.VarChar(50), proximoServicio)
                    .input('Estado', sql.VarChar(50), 'Cargando...')
                    .input('UM', sql.VarChar(20), areaUM)
                    .input('CodArt', sql.VarChar(50), exec.codArticulo || null)
                    .input('IdProdReact', sql.Int, idProdReact)
                    .input('ProIdProducto', sql.Int, exec.proIdProducto || null)
                    .input('CliIdCliente', sql.Int, cliIdCliente)
                    .input('F_EntSec', sql.DateTime, fechaEntradaSector)
                    .input('BobID', sql.Int, (bobinaId && !exec.isExtra) ? parseInt(bobinaId) : null) // TELA CLIENTE: solo la orden principal (los extras no consumen tela)
                    .input('DisenadorID', sql.Int, req.disenadorId || null) // pedido creado por un DISEÑADOR en nombre del cliente
                    .input('Tinta', sql.VarChar(50), tintaFinal) // ECOUV: rutea lote (magic sort agrupa por Tinta); producto terminado la toma de su ficha
                    .input('EstadoDep', sql.VarChar(50), estadoDependenciaExec)
                    .input('LiberaCuando', sql.Int, liberaCuandoOrdenIDExec)
                    .input('WmsVarianteId', sql.Int, exec.wmsVarianteId ? parseInt(exec.wmsVarianteId) : null)
                    // [COMBOS] Qué componente del combo es esta orden (Gorro/Short...). NULL =
                    // producto simple o "Comprar y Personalizar" — comportamiento de siempre.
                    .input('ComboItemID', sql.Int, exec.comboItemId ? parseInt(exec.comboItemId) : null)
                    .input('PrendaCliID', sql.Int, exec.prendaClienteId ? parseInt(exec.prendaClienteId) : null)
                    .query(`
                        INSERT INTO Ordenes (
                            AreaID, Cliente, CodCliente, IdClienteReact, DescripcionTrabajo, Prioridad,
                            FechaIngreso, FechaEstimadaEntrega, Material, Variante,
                            CodigoOrden, NoDocERP, Nota, Magnitud, ProximoServicio, UM, Estado, EstadoenArea,
                            CodArticulo, IdProductoReact, ProIdProducto, CliIdCliente, FechaEntradaSector,
                            BobinaTelaID, DisenadorID, Tinta, EstadoDependencia, LiberaCuandoOrdenID, WmsVarianteId,
                            ComboItemID, PrendaClienteID
                        )
                        OUTPUT INSERTED.OrdenID
                        VALUES (
                            @AreaID, @Cliente, @CodCliente, @IdClienteReact, @Desc, @Prio,
                            GETDATE(), DATEADD(day, 3, GETDATE()), @Mat, @Var,
                            @Cod, @ERP, @Nota, @Mag, @Prox, @UM, @Estado, @Estado,
                            @CodArt, @IdProdReact, @ProIdProducto, @CliIdCliente, @F_EntSec,
                            @BobID, @DisenadorID, @Tinta, @EstadoDep, @LiberaCuando, @WmsVarianteId,
                            @ComboItemID, @PrendaCliID
                        )
                    `);

                const newOID = resOrder.recordset[0].OrdenID;
                generatedOrders.push(exec.codigoOrden);
                generatedIDs.push(newOID);

                // [INGRESO INTERNO] Quién del personal cargó el pedido (impersonarClienteInterno /
                // conversión de Solicitud). Con esto la matriz de TPU se aprueba internamente y no
                // viaja al portal. Va aparte del INSERT y protegido por COL_LENGTH: si la columna
                // todavía no existe en la base (SQL sin correr), no hace nada y no rompe el alta.
                if (req.user?.impersonadoPorInterno) {
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, newOID)
                        .input('IntPor', sql.Int, parseInt(req.user.impersonadoPorInterno, 10) || null)
                        .query(`IF COL_LENGTH('dbo.Ordenes', 'IngresoInternoPor') IS NOT NULL
                                    EXEC sp_executesql N'UPDATE dbo.Ordenes SET IngresoInternoPor = @IntPor WHERE OrdenID = @OID',
                                                       N'@IntPor INT, @OID INT', @IntPor = @IntPor, @OID = @OID;`);
                }

                // Fecha real: plan fijo + compromiso por agenda (nunca antes del plan). No
                // bloqueante — si falla, queda el DATEADD(day,3,GETDATE()) del INSERT.
                try { await calcularFechasOrden(transaction, newOID); }
                catch (feErr) { logger.error(`⚠️ calcularFechasOrden falló para OrdenID ${newOID}: ${feErr.message}`); }
                // [PRENDAS] Guarda el primer OrdenID insertado para esta área (o para esta
                // área DE ESTE COMPONENTE, si es un combo) — es lo que usa una Orden
                // encadenada más adelante en el loop (ej. Estampado → su DTF/TPU).
                const claveArea = claveOrdenArea(grupoDeExec(exec), exec.areaID.toUpperCase());
                if (!insertedOrdenIdByAreaId[claveArea]) {
                    insertedOrdenIdByAreaId[claveArea] = newOID;
                }
                if (exec.chainKey) insertedOrdenIdByChainKey[exec.chainKey] = newOID;

                // [VENTA UNA LÍNEA] Cada artículo del carrito como línea extra de la PRO única:
                // ServiciosExtraOrden es lo que la cotización (erpSyncService) ya cotiza por
                // artículo y suma en la misma orden — así el pedido tiene UNA fila en depósito
                // con el total. Nacen con Estado 'OK': esas filas también cuentan para "¿la orden
                // está completa?" (pedidoCompletoService) y un artículo comprado no se controla
                // como un servicio; sin esto la PRO nunca quedaría completa.
                if (exec.articulosVenta) {
                    for (const art of exec.articulosVenta) {
                        const proId = parseInt(art.proIdProducto, 10);
                        if (!proId) continue;
                        const a = await new sql.Request(transaction).input('PID', sql.Int, proId)
                            .query(`SELECT TOP 1 LTRIM(RTRIM(CodArticulo)) AS CodArt, LTRIM(RTRIM(CodStock)) AS CodStock,
                                           LTRIM(RTRIM(Descripcion)) AS Descripcion FROM Articulos WHERE ProIdProducto = @PID`);
                        const artRow = a.recordset[0];
                        if (!artRow?.CodArt) {
                            logger.warn(`[VENTA] ${exec.codigoOrden}: el artículo ${proId} no tiene CodArticulo — no se agrega su línea de precio.`);
                            continue;
                        }
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Cod', sql.VarChar(50), artRow.CodArt)
                            .input('Stk', sql.VarChar(50), artRow.CodStock || null)
                            .input('Desc', sql.NVarChar(300), String(art.descripcion || artRow.Descripcion || '').slice(0, 300))
                            .input('Cant', sql.Decimal(18, 2), parseFloat(art.cantidad) || 1)
                            .query(`INSERT INTO ServiciosExtraOrden
                                        (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro, Estado)
                                    VALUES (@OID, @Cod, @Stk, @Desc, @Cant, 0, 0, '[ARTICULO VENTA]', GETDATE(), 'OK')`);
                    }
                }

                // [PRENDA CLIENTE] AUTO-FULFILL DEL REQUISITO "PRENDA" — calco del mismo bloque
                // en webOrdersController.js (flujo de Bordado). Si la prenda que esta orden va a
                // trabajar YA está físicamente en esta área (llegó por remito interno antes de
                // que se creara el pedido), el requisito nace CUMPLIDO con el detalle de qué
                // prenda es. Si todavía está en Recepción o en tránsito, acá no pasa nada: se
                // cumple solo cuando se reciba el remito (AUTO-FULFILL PRENDA DE CLIENTE en
                // logisticsController.receiveDispatch). Best-effort: sin esto la orden igual
                // existe, solo que el operario tiene que tildar el requisito a mano.
                if (exec.prendaClienteId) {
                    try {
                        const prendaRes = await new sql.Request(transaction)
                            .input('PID', sql.Int, parseInt(exec.prendaClienteId))
                            .input('Area', sql.VarChar(20), exec.areaID)
                            .query(`
                                SELECT p.Descripcion, p.Talle, p.Color, r.Codigo AS CodigoRecepcion
                                FROM InventarioPrendasCliente p
                                LEFT JOIN Recepciones r ON r.RecepcionID = p.RecepcionID
                                LEFT JOIN Logistica_Bultos b ON (b.CodigoEtiqueta = r.Codigo OR b.CodigoEtiqueta LIKE r.Codigo + '-%')
                                WHERE p.PrendaClienteID = @PID AND b.UbicacionActual = @Area
                            `);
                        if (prendaRes.recordset.length) {
                            const { Descripcion, Talle, Color, CodigoRecepcion } = prendaRes.recordset[0];
                            const reqPrenda = await new sql.Request(transaction)
                                .input('Area', sql.VarChar(20), exec.areaID)
                                .query(`SELECT RequisitoID FROM ConfigRequisitosProduccion WHERE AreaID = @Area AND CodigoRequisito = 'PRENDA'`);
                            if (reqPrenda.recordset.length) {
                                const partes = [Descripcion || 'prenda del cliente'];
                                if (Talle) partes.push(`talle ${Talle}`);
                                if (Color) partes.push(Color);
                                const obsPrenda = `Asignado: ${partes.join(' — ')}${CodigoRecepcion ? ` [${CodigoRecepcion.trim()}]` : ''}`;
                                await new sql.Request(transaction)
                                    .input('OID', sql.Int, newOID)
                                    .input('Area', sql.VarChar(20), exec.areaID)
                                    .input('RID', sql.Int, reqPrenda.recordset[0].RequisitoID)
                                    .input('Obs', sql.NVarChar(500), obsPrenda)
                                    .query(`
                                        IF NOT EXISTS (SELECT 1 FROM OrdenCumplimientoRequisitos WHERE OrdenID = @OID AND RequisitoID = @RID)
                                            INSERT INTO OrdenCumplimientoRequisitos (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                                            VALUES (@OID, @Area, @RID, 'CUMPLIDO', GETDATE(), @Obs)
                                    `);
                            }
                        }
                    } catch (reqErr) {
                        logger.warn(`[PRENDA CLIENTE] Orden ${newOID}: no se pudo auto-cumplir el requisito PRENDA: ${reqErr.message}`);
                    }
                }

                // TPU trabajo nuevo: cobrar la matriz (artículo 156 = US$15) como línea de facturación.
                // El reuso de matriz va por /reuse-matriz y NO pasa por acá, así que ahí no se cobra.
                // [TPU COMO PORTAL] También cuando el TPU es servicio de una prenda (pedido interno o
                // solicitud): es un trabajo nuevo con matriz nueva, igual que en el portal. "Hago mi
                // matriz" (matrizPropia) y el reuso (/reuse-matriz) siguen sin cargo.
                if (String(exec.areaID || '').toUpperCase() === 'TPU' && !exec.matrizPropia) {
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, newOID)
                        .query(`INSERT INTO ServiciosExtraOrden (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro)
                                VALUES (@OID, '156', '1.1.10.1', 'Matriz TPU', 1, 0, 0, 'Cargo de matriz (trabajo nuevo TPU)', GETDATE())`);
                }

                // --- TELA CLIENTE: Descontar metros de la bobina ---
                // Una sola vez por pedido, en la orden principal. Los metros vienen del body
                // (magnitud, top-level) porque exec.magnitudInicial de la principal es 0 al crear
                // (la Magnitud real la van sumando los archivos después).
                if (bobinaId && !exec.isExtra && !telaDescontada) {
                    const bid = parseInt(bobinaId);
                    const mag = parseFloat(magnitud) || parseFloat(exec.magnitudInicial) || 0;

                    if (mag <= 0) {
                        logger.warn(`[TELA-CLIENTE] Orden ${newOID}: bobina ${bid} indicada pero sin metros a descontar (magnitud='${magnitud}').`);
                    } else {
                        const checkBob = await new sql.Request(transaction)
                            .input('BID', sql.Int, bid)
                            .query(`SELECT MetrosRestantes, InsumoID FROM InventarioBobinas WHERE BobinaID = @BID`);

                        if (!checkBob.recordset.length) throw new Error('Bobina de tela no encontrada.');
                        const { MetrosRestantes, InsumoID } = checkBob.recordset[0];
                        if (mag > MetrosRestantes) {
                            throw new Error(`La bobina solo tiene ${MetrosRestantes}m disponibles. El pedido requiere ${mag}m.`);
                        }

                        // Descuento CONDICIONADO (MetrosRestantes >= @Mts): dos pedidos simultáneos
                        // no pueden dejar la bobina en negativo — el segundo no matchea y falla acá.
                        const updRes = await new sql.Request(transaction)
                            .input('BID', sql.Int, bid)
                            .input('Mts', sql.Decimal(10, 2), mag)
                            .query(`
                                UPDATE InventarioBobinas
                                SET MetrosRestantes = MetrosRestantes - @Mts,
                                    Estado = CASE
                                        WHEN (MetrosRestantes - @Mts) <= 0.5 THEN 'Agotado'
                                        ELSE Estado
                                    END
                                WHERE BobinaID = @BID AND MetrosRestantes >= @Mts
                            `);
                        if (!updRes.rowsAffected[0]) {
                            throw new Error('La bobina ya no tiene metros suficientes (consumidos por otro pedido).');
                        }

                        // Registrar movimiento CONSUMO_ORDEN (fuente de verdad para la devolución al cancelar)
                        await new sql.Request(transaction)
                            .input('IID', sql.Int, InsumoID)
                            .input('BID', sql.Int, bid)
                            .input('OID', sql.Int, newOID)
                            .input('Mts', sql.Decimal(10, 2), mag)
                            .input('UID', sql.Int, req.user?.id || 1)
                            .input('Ref', sql.NVarChar(300), `Consumo Orden ${exec.codigoOrden || newOID} - ${jobName}`)
                            .query(`
                                INSERT INTO MovimientosInsumos
                                    (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID, OrdenID, FechaMovimiento)
                                VALUES (@IID, @BID, 'CONSUMO_ORDEN', -@Mts, @Ref, @UID, @OID, GETDATE())
                            `);

                        telaDescontada = true;
                        logger.info(`[TELA-CLIENTE] Orden ${newOID}: descontados ${mag}m de bobina ${bid}. Restantes: ${MetrosRestantes - mag}m`);
                    }
                } else if (!exec.isExtra && exec.areaID === 'SB') {
                    // [REQUISITOS] Sublimación sin bobina de cliente: material propio de la
                    // empresa (el caso normal en "Fabricar a Medida" — acá no hay noción de
                    // "el cliente trajo su tela", la prenda se arma de cero). El requisito TELA
                    // nunca se va a cumplir por esta vía — nace CUMPLIDO ("no aplica") en vez
                    // de quedar bloqueado para siempre. Mismo criterio que webOrdersController.js.
                    await marcarRequisitoNoAplica(transaction, {
                        ordenId: newOID, areaId: exec.areaID, codigoRequisito: 'TELA', exact: false,
                        observaciones: 'No aplica — material propio de la empresa'
                    });
                }

                // [REQUISITOS] Estampado (EST): mismo criterio "1 de 3" que webOrdersController.js
                // — PRENDA/DTF/TPU se exigen los 3 en ConfigRequisitosProduccion pero cada orden
                // real sale de UN solo canal. Acá el canal ya viene resuelto en
                // chainedAfterAreaId (armado por el frontend para EST) o, si no hay transfer
                // encadenado, por la presencia de Bordado en el mismo lote.
                if (exec.areaID.toUpperCase() === 'EST') {
                    const cadena = exec.chainedAfterAreaId ? String(exec.chainedAfterAreaId).toUpperCase() : null;
                    let canalReal = cadena === 'DF' ? 'DTF' : (cadena === 'TPU' ? 'TPU' : null);
                    if (!canalReal && !cadena) {
                        const loteEst = exec.comboItemId
                            ? pendingOrderExecutions.filter(e => e.comboItemId === exec.comboItemId)
                            : pendingOrderExecutions;
                        if (loteEst.some(e => (e.areaID || '').toUpperCase() === 'EMB')) canalReal = 'PRENDA';
                    }
                    // [PRENDAS] En este formulario SIEMPRE hay una prenda física detrás (comprada,
                    // fabricada, de combo o del cliente — el lote trae orden madre PRO): el
                    // Estampado necesita el transfer Y la prenda. La regla "1 de 3" viene del
                    // portal, donde un Estampado sale de un solo canal; acá marcar PRENDA como
                    // "no aplica" dejaba al Estampado listo para trabajar con el transfer recibido
                    // mientras la prenda seguía en Bordado sin remito (caso EST-20947: PRENDA
                    // cumplida 07:00 al crear el pedido, el short todavía en EMB). La prenda se
                    // cumple sola al recibir el remito del área que la trae (Bordado, Costura, o
                    // la venta de retiro desde PRO).
                    const hayPrendaFisica = pendingOrderExecutions.some(e => e.esProductoComprado || e.esProductoFabricado);
                    if (canalReal) {
                        for (const cod of ['PRENDA', 'DTF', 'TPU']) {
                            if (cod === canalReal) continue;
                            if (cod === 'PRENDA' && hayPrendaFisica) continue;
                            await marcarRequisitoNoAplica(transaction, {
                                ordenId: newOID, areaId: exec.areaID, codigoRequisito: cod,
                                observaciones: `No aplica — el canal real de este Estampado es ${canalReal}`
                            });
                        }
                    } else {
                        logger.warn(`[ESTAMPADO] Orden ${newOID}: canal ambiguo (chainedAfterAreaId=${exec.chainedAfterAreaId || 'null'}) — quedan los 3 requisitos pendientes.`);
                    }
                }

                // --- NOMBRE DE LOS ARCHIVOS: MATERIAL AL PRINCIPIO (SOLO SUBLIMACIÓN) ---
                // El resto de las áreas mantiene el nombre de siempre (ORDEN_CLIENTE_TRABAJO_Archivo...).
                const nombreNuevo = await usaNombreNuevo(exec.areaID);
                let materialNombreArchivo = '';
                if (nombreNuevo) {
                    // Tela de cliente: al material se le agrega el PRE de la recepción de esa tela.
                    let preTelaCliente = null;
                    if (bobinaId && !exec.isExtra) {
                        try {
                            const telaRes = await new sql.Request(transaction)
                                .input('BID', sql.Int, parseInt(bobinaId))
                                .query('SELECT Referencia FROM InventarioBobinas WHERE BobinaID = @BID');
                            preTelaCliente = telaRes.recordset[0]?.Referencia || null;
                        } catch (_) { /* sin PRE: el nombre queda solo con el material */ }
                    }
                    materialNombreArchivo = materialParaNombre(exec.material, preTelaCliente);
                }

                // --- REGISTRAR ARCHIVOS ESPERADOS (PLACEHOLDERS) ---
                let totalMagnitud = 0;
                let fileCount = 0;
                let termCatalogCache = null; // catálogo de Terminaciones (se carga una vez si algún item las trae)

                for (let i = 0; i < exec.items.length; i++) {
                    const item = exec.items[i];
                    // sanitize ya está definido arriba

                    // Calcular UM una sola vez por item
                    const umLower = areaUM.toLowerCase();

                    // ARCHIVO PRINCIPAL
                    if (item.fileName) {
                        // FRONTEND ENVÍA METROS AHORA.
                        const wM = parseFloat(item.width) || 0;
                        const hM = parseFloat(item.height) || 0;

                        // CÁLCULO DE METROS SEGÚN UM
                        let valMetros = 0;

                        if (umLower === 'm2') {
                            valMetros = (wM * hM);
                        } else if (umLower === 'm') {
                            valMetros = hM; // Solo ALTO
                        } else {
                            valMetros = 0; // Para unidades, no sumamos "Metros" en el archivo individual, o sí?
                            // Si es unitario, el archivo ocupa "nada" en metros, pero "1" en cantidad.
                        }

                        // Extraer extensión
                        const safeItemName = sanitizeFileName(item.fileName);
                        const parts = safeItemName.split('.');
                        const ext = parts.length > 1 ? `.${parts.pop()}` : '';

                        // SUBLIMACIÓN: {MATERIAL}-{ORDEN}_{CLIENTE}_Arch {i} de {n} (x{copias}).ext
                        // Resto de áreas: formato de siempre.
                        const finalName = nombreNuevo
                            ? construirNombreArchivo({
                                material: materialNombreArchivo,
                                codigoOrden: exec.codigoOrden,
                                cliente: nombreCliente,
                                idx: i + 1,
                                total: exec.items.length,
                                copias: item.copies || 1,
                                ext
                            })
                            : `${exec.codigoOrden.replace(/\//g, '-')}_${sanitize(nombreCliente)}_${sanitize(jobName)}_Archivo ${i + 1} de ${exec.items.length} (x${item.copies || 1})${ext}`;

                        const resFile = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Nom', sql.VarChar(200), finalName)
                            .input('Tipo', sql.VarChar(50), 'Impresion')
                            .input('Cop', sql.Int, item.copies || 1)
                            .input('Met', sql.Decimal(10, 3), valMetros)
                            .input('Ancho', sql.Decimal(10, 2), wM)
                            .input('Alto', sql.Decimal(10, 2), hM)
                            .input('Obs', sql.NVarChar(sql.MAX), item.observaciones || '')
                            .input('CodArt', sql.VarChar(50), exec.codArticulo || null)
                            .input('SinDPI', sql.Bit, item.sinDPI || null)
                            .query(`
                                INSERT INTO ArchivosOrden (
                                    OrdenID, NombreArchivo, TipoArchivo, Copias, Metros, EstadoArchivo, FechaSubida,
                                    Ancho, Alto, Observaciones, CodigoArticulo, SinDPI
                                ) 
                                OUTPUT INSERTED.ArchivoID 
                                VALUES (
                                    @OID, @Nom, @Tipo, @Cop, @Met, 'Pendiente', GETDATE(),
                                    @Ancho, @Alto, @Obs, @CodArt, @SinDPI
                                )
                            `);

                        filesToUpload.push({
                            dbId: resFile.recordset[0].ArchivoID,
                            type: 'ORDEN',
                            originalName: item.fileName, // Para que el front sepa cuál es
                            fileKey: item.fileKey || null, // match exacto en el front; originalName queda de fallback
                            finalName: finalName,
                            area: exec.areaID
                        });

                        // TERMINACIONES POR ARCHIVO (ECOUV): quedan DENTRO de la misma orden,
                        // ligadas al archivo (OrdenTerminaciones) + línea de facturación en
                        // ServiciosExtraOrden. NO se crea una orden aparte.
                        if (Array.isArray(item.terminaciones) && item.terminaciones.length > 0) {
                            if (!termCatalogCache) {
                                const tc = await new sql.Request(transaction)
                                    .query("SELECT TerminacionID, Nombre, CodArticulo, UnidadCobro FROM Terminaciones WHERE Activo = 1");
                                termCatalogCache = new Map(tc.recordset.map(t => [t.TerminacionID, t]));
                            }
                            const archivoId = resFile.recordset[0].ArchivoID;
                            for (const term of item.terminaciones) {
                                const tid = parseInt(term.terminacionId);
                                const tInfo = termCatalogCache.get(tid);
                                if (!tInfo) {
                                    logger.warn(`[WebOrder] Terminación ${term.terminacionId} inexistente/inactiva: ignorada (orden ${newOID})`);
                                    continue;
                                }
                                const cantTerm = parseFloat(term.cantidad) || 1;
                                // Ubicacion (en qué bordes va) y ParamCliente (separación de los
                                // ojales / distancia del bolsillo al borde) viajan igual que en
                                // el pedido web: sin esto el taller no sabe dónde ni cómo hacerlo.
                                const paramCli = (term.param !== undefined && term.param !== null && term.param !== '')
                                    ? parseFloat(term.param) : null;
                                await new sql.Request(transaction)
                                    .input('OID', sql.Int, newOID)
                                    .input('AID', sql.Int, archivoId)
                                    .input('TID', sql.Int, tid)
                                    .input('Cnt', sql.Decimal(18, 2), cantTerm)
                                    .input('Ubi', sql.VarChar(30), term.ubicacion ? String(term.ubicacion).trim() : null)
                                    .input('Par', sql.Decimal(9, 2), isNaN(paramCli) ? null : paramCli)
                                    .query("INSERT INTO OrdenTerminaciones (OrdenID, ArchivoID, TerminacionID, Cantidad, Ubicacion, ParamCliente) VALUES (@OID, @AID, @TID, @Cnt, @Ubi, @Par)");

                                if (tInfo.CodArticulo) {
                                    await new sql.Request(transaction)
                                        .input('OID', sql.Int, newOID)
                                        .input('Cod', sql.VarChar(50), String(tInfo.CodArticulo).trim())
                                        .input('Des', sql.NVarChar(255), `Terminación: ${tInfo.Nombre}`)
                                        .input('Cnt', sql.Decimal(18, 2), cantTerm)
                                        .query(`
                                            -- Estado OK de entrada: la línea es solo para facturar; el
                                            -- trabajo se controla en el área de Terminaciones.
                                            INSERT INTO ServiciosExtraOrden
                                            (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro, Estado, Controlcopias)
                                            VALUES (@OID, @Cod, '', @Des, @Cnt, 0, 0, 'Terminación por archivo (WebOrder)', GETDATE(), 'OK', @Cnt)
                                        `);
                                }
                            }
                            logger.info(`[WebOrder] ${item.terminaciones.length} terminaciones registradas para archivo ${archivoId} (orden ${newOID})`);
                        }

                        // PRODUCTO TERMINADO: sus terminaciones INCLUIDAS (ficha del producto)
                        // también se registran en OrdenTerminaciones para que control de calidad
                        // derive la orden al armado y la bandeja las muestre como checklist.
                        // SIN línea de facturación: ya están dentro del precio cerrado.
                        if (esProductoTerminado && exec.codArticulo) {
                            try {
                                const incRes = await new sql.Request(transaction)
                                    .input('Art', sql.VarChar, String(exec.codArticulo).trim())
                                    .query(`
                                        SELECT PT.TerminacionID, PT.Cantidad
                                        FROM ProductoTerminadoTerminaciones PT
                                        INNER JOIN ProductosTerminados P ON P.ID = PT.ProductoID
                                        INNER JOIN Terminaciones T ON T.TerminacionID = PT.TerminacionID AND T.Activo = 1
                                        WHERE LTRIM(RTRIM(P.CodArticulo)) = @Art
                                    `);
                                const archivoIdPT = resFile.recordset[0].ArchivoID;
                                for (const inc of incRes.recordset) {
                                    const cantInc = (parseFloat(inc.Cantidad) || 1) * (item.copies || 1);
                                    await new sql.Request(transaction)
                                        .input('OID', sql.Int, newOID)
                                        .input('AID', sql.Int, archivoIdPT)
                                        .input('TID', sql.Int, inc.TerminacionID)
                                        .input('Cnt', sql.Decimal(18, 2), cantInc)
                                        .query("INSERT INTO OrdenTerminaciones (OrdenID, ArchivoID, TerminacionID, Cantidad) VALUES (@OID, @AID, @TID, @Cnt)");
                                }
                                if (incRes.recordset.length > 0) {
                                    logger.info(`[WebOrder] ${incRes.recordset.length} terminaciones INCLUIDAS del producto ${exec.codArticulo} registradas (orden ${newOID})`);
                                }
                            } catch (ePT) {
                                logger.warn('[WebOrder] No se pudieron registrar terminaciones incluidas del producto terminado:', ePT.message);
                            }
                        }

                        // CÁLCULO DE MAGNITUD TOTAL
                        if (umLower === 'u') {
                            totalMagnitud += (item.copies || 1);
                        } else {
                            totalMagnitud += (valMetros * (item.copies || 1));
                        }

                        fileCount++;
                    }

                    // ARCHIVO DORSO (Back)
                    if (item.fileBackName) {
                        // Calcular Metros Dorso
                        let valMetrosBack = 0;
                        // Extraer dimensiones SIEMPRE, no solo para ml/m2
                        const wMBack = parseFloat(item.widthBack) || 0;
                        const hMBack = parseFloat(item.heightBack) || 0;

                        if (umLower === 'ml' || umLower === 'm2') {
                            if (umLower === 'ml') valMetrosBack = hMBack; // Metros lineales = Alto
                            else valMetrosBack = wMBack * hMBack; // Metros cuadrados
                        } else if (umLower === 'u') {
                            valMetrosBack = 0; // Unitario no ocupa metros para cobro, pero sí tiene dimensiones físicas
                        }

                        const safeBackName = sanitizeFileName(item.fileBackName);
                        const partsBack = safeBackName.split('.');
                        const extBack = partsBack.length > 1 ? `.${partsBack.pop()}` : '';
                        const finalNameBack = nombreNuevo
                            ? construirNombreArchivo({
                                material: materialNombreArchivo,
                                codigoOrden: exec.codigoOrden,
                                cliente: nombreCliente,
                                idx: i + 1,
                                total: exec.items.length,
                                copias: item.copies || 1,
                                ext: extBack,
                                dorso: true
                            })
                            : `${exec.codigoOrden.replace(/\//g, '-')}_${sanitize(nombreCliente)}_${sanitize(jobName)}_DORSO Archivo ${i + 1} de ${exec.items.length} (x${item.copies || 1})${extBack}`;

                        const obsBack = (item.observacionesBack || '') + (item.observacionesBack?.includes('DORSO') ? '' : ' [DORSO]');

                        const resFileBack = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Nom', sql.VarChar(200), finalNameBack)
                            .input('Tipo', sql.VarChar(50), 'Impresion') // FIX: Usar 'Impresion' estándar
                            .input('Cop', sql.Int, item.copies || 1)
                            .input('Met', sql.Decimal(10, 3), valMetrosBack)
                            .input('Ancho', sql.Decimal(10, 2), wMBack)
                            .input('Alto', sql.Decimal(10, 2), hMBack)
                            .input('Obs', sql.NVarChar(sql.MAX), obsBack)
                            .input('CodArt', sql.VarChar(50), exec.codArticulo || null)
                            .input('SinDPI', sql.Bit, item.sinDPIBack || null)
                            .query(`
                                INSERT INTO ArchivosOrden (
                                    OrdenID, NombreArchivo, TipoArchivo, Copias, Metros, EstadoArchivo, FechaSubida,
                                    Ancho, Alto, Observaciones, CodigoArticulo, SinDPI
                                ) 
                                OUTPUT INSERTED.ArchivoID 
                                VALUES (
                                    @OID, @Nom, @Tipo, @Cop, @Met, 'Pendiente', GETDATE(),
                                    @Ancho, @Alto, @Obs, @CodArt, @SinDPI
                                )
                            `);

                        filesToUpload.push({
                            dbId: resFileBack.recordset[0].ArchivoID,
                            type: 'ORDEN',
                            originalName: item.fileBackName, // Nombre real para buscar en upload
                            fileKey: item.fileBackKey || null,
                            finalName: finalNameBack,
                            area: exec.areaID
                        });

                        // Sumar magnitud dorso si corresponde (generalmente Twinface se cobra por m2 total o u, si es doble cara quizás suma m2)
                        // Si es 'u', ya se sumó por el frente (es el mismo objeto físico).
                        // Si es 'm2' o 'ml', IMPRESIÓN doble cara consume TINTA y MATERIAL DOBLE si es rollo?
                        // Si es Impresion Directa (DTF UV), se cobra por cara?
                        // Asumiremos que si hay archivo dorso, suma metros.
                        if (umLower !== 'u') {
                            totalMagnitud += (valMetrosBack * (item.copies || 1));
                        }
                        fileCount++;
                    }
                }

                if (fileCount > 0) {
                    await new sql.Request(transaction).input('OID', sql.Int, newOID).input('C', sql.Int, fileCount).input('Mag', sql.Decimal(10, 2), totalMagnitud)
                        .query("UPDATE Ordenes SET ArchivosCount = @C, Magnitud = CAST(@Mag AS VARCHAR) WHERE OrdenID = @OID");
                } else if (['TWC', 'TWT'].includes(String(exec.areaID || '').toUpperCase()) && parseInt(exec.magnitudInicial) > 0) {
                    // [CORTE/COSTURA] sin archivo de impresión: la cantidad es la de prendas del pedido (ver magnitudInicial)
                    await new sql.Request(transaction).input('OID', sql.Int, newOID).input('Mag', sql.VarChar(50), String(parseInt(exec.magnitudInicial)))
                        .query("UPDATE Ordenes SET Magnitud = @Mag WHERE OrdenID = @OID AND ISNULL(TRY_CAST(Magnitud AS FLOAT), 0) = 0");
                } else if (String(exec.areaID || '').toUpperCase() === 'EMB') {
                    // [BORDADO] sin archivo de impresión: prendas a bordar
                    const cantEmb = parseInt(exec.metadata?.prendas, 10)
                        || parseInt(exec.magnitudInicial, 10)
                        || prendasPedido || 0;
                    if (cantEmb > 0) {
                        await new sql.Request(transaction).input('OID', sql.Int, newOID).input('Mag', sql.VarChar(50), String(Math.round(cantEmb)))
                            .query("UPDATE Ordenes SET Magnitud = @Mag WHERE OrdenID = @OID");
                    }
                } else if (String(exec.areaID || '').toUpperCase() === 'EST') {
                    // [ESTAMPADO] servicio de planchado/estampa: prendas × bajadas por prenda
                    const prendasEst = parseInt(exec.metadata?.prendas, 10) || prendasPedido || 0;
                    const porPrenda = parseInt(exec.metadata?.estampadosPorPrenda, 10) || 1;
                    const cantEst = (prendasEst * porPrenda) || parseInt(exec.magnitudInicial, 10) || 0;
                    if (cantEst > 0) {
                        await new sql.Request(transaction).input('OID', sql.Int, newOID).input('Mag', sql.VarChar(50), String(Math.round(cantEst)))
                            .query("UPDATE Ordenes SET Magnitud = @Mag WHERE OrdenID = @OID");
                    }
                } else if (String(exec.areaID || '').toUpperCase() === 'TPU') {
                    // TPU (boceto): el cliente sube un boceto, no arte, así que no hay ArchivosOrden que
                    // lleven la cantidad. La Magnitud (unidades de TPU a producir) sale de la suma de
                    // copies de los items; [TPU COMO PORTAL] si el TPU es servicio de una prenda (sin
                    // items), de los metadatos: prendas × bajadas — mismo cálculo que el procesador de
                    // solicitudes. Si no, la orden queda en Magnitud 0 y no se cotiza la producción.
                    const cantTpu = (exec.items || []).reduce((s, it) => s + (parseInt(it.copies) || 0), 0)
                        || ((parseInt(exec.metadata?.prendas) || 0) * (parseInt(exec.metadata?.estampadosPorPrenda) || 1))
                        || parseInt(exec.magnitudInicial) || 0;
                    if (cantTpu > 0) {
                        // Entero y como texto: TPU se mide en UNIDADES (espeja webOrdersController).
                        await new sql.Request(transaction).input('OID', sql.Int, newOID).input('Mag', sql.VarChar(50), String(Math.round(cantTpu)))
                            .query("UPDATE Ordenes SET Magnitud = @Mag WHERE OrdenID = @OID");
                    }
                }

                // HERMANA TERMINAC DESDE EL INGRESO (pedido negocio 28/07): si la orden ECOUV
                // quedó con terminaciones, la hermana XEUV-{doc} se crea YA. Idempotente.
                if (String(exec.areaID || '').toUpperCase() === 'ECOUV') {
                    try {
                        const { crearHermanaTerminaciones } = require('../utils/hermanaTerminaciones');
                        await crearHermanaTerminaciones(transaction, newOID);
                    } catch (eHer) {
                        logger.warn(`[PrendasOrder] No se pudo crear la hermana de terminaciones de la orden ${newOID}:`, eHer.message);
                    }
                }

                // --- DEPURACIÓN: LOG DE REFERENCIAS ---
                // logger.info(`[Order ${exec.codigoOrden}] RefCount: ${exec.referencias?.length || 0}`);

                // --- ARCHIVOS DE REFERENCIA ---

                // 0. REFERENCIAS VINCULADAS AL SERVICIO (Nueva Lógica)
                if (exec.referencias && exec.referencias.length > 0) {
                    // Mismo archivo con el mismo tipo dos veces en la misma orden = UNA sola referencia.
                    // (BOR-26025: el boceto de bordado llegaba repetido desde el formulario y quedaban dos filas
                    // idénticas.) Un prediseño no cae acá: tiene otro nombre ("… PREDISENO.png") y otro tipo.
                    const refsVistas = new Set();
                    for (const ref of exec.referencias) {
                        const claveRef = `${String(ref.tipo || 'REFERENCIA').toUpperCase()}|${ref.name}`;
                        if (refsVistas.has(claveRef)) continue;
                        refsVistas.add(claveRef);
                        // Si la referencia trae "etiqueta" (ej: boceto Twinface "Boceto Archivo 1 de 3"),
                        // el nombre guardado usa la etiqueta + la extensión real, para identificar a qué
                        // archivo pertenece. El originalName (match de subida) sigue siendo ref.name.
                        let baseName = sanitize(ref.name);
                        if (ref.etiqueta) {
                            const dot = ref.name.lastIndexOf('.');
                            const ext = dot > 0 ? ref.name.substring(dot) : '';
                            baseName = `${sanitize(ref.etiqueta)}${ext}`;
                        }
                        const fName = `REF-${erpDocNumber}-${baseName}`;
                        const tipo = ref.tipo || 'REFERENCIA';

                        const resRef = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), tipo)
                            .input('Nom', sql.VarChar(200), fName)
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, @Tipo, @Nom, GETDATE(), 'Pendiente')`);

                        filesToUpload.push({
                            dbId: resRef.recordset[0].RefID,
                            type: 'REF',
                            originalName: ref.name,
                            // Clave única del archivo (ver filesToUploadMap en el front): con dos
                            // diseños de bordado con logos del mismo nombre, por nombre se pisaban.
                            fileKey: ref.fileKey || null,
                            finalName: fName,
                            area: 'GENERAL'
                        });
                    }
                }

                // [BORDADO] Ficha del diseño (pedido de prendas, una orden por diseño): la misma fila
                // 'BORDADO' de ArchivosOrden que guarda el form de bordado del portal
                // (webOrdersController), con medidas, piezas, paleta y puntadas estimadas. La usan la
                // bandeja de Bordado, el detalle de la orden y el precio: erpSyncService cotiza el
                // bordado por estas puntadas (PuntadasBordado). Sin ellas la tarifa daba $0 y, en
                // "Factura por área", la línea del bordado ni se guardaba (BOR-31891, 20/10).
                const disenoBordado = String(exec.areaID || '').toUpperCase() === 'EMB' ? exec.metadata?.disenoBordado : null;
                if (disenoBordado) {
                    ordenesMatrizAuto.push(newOID);
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, newOID)
                        .input('Nom', sql.VarChar(200), String(disenoBordado.logo || 'Diseño').slice(0, 200))
                        .input('Ancho', sql.Decimal(10, 2), parseFloat(disenoBordado.anchoCm) || null)
                        .input('Alto', sql.Decimal(10, 2), parseFloat(disenoBordado.altoCm) || null)
                        .input('Piezas', sql.Int, parseInt(disenoBordado.cantidad) || null)
                        .input('Paleta', sql.NVarChar(sql.MAX),
                            (Array.isArray(disenoBordado.paleta) && disenoBordado.paleta.length) ? JSON.stringify(disenoBordado.paleta) : null)
                        .input('Punt', sql.Int, parseInt(disenoBordado.puntadasEstimadas) || null)
                        .query(`
                            INSERT INTO ArchivosOrden
                                (OrdenID, NombreArchivo, Copias, Ancho, Alto, Piezas, PaletaBordado, PuntadasEstimadas, TipoArchivo, FechaSubida)
                            VALUES (@OID, @Nom, 1, @Ancho, @Alto, @Piezas, @Paleta, @Punt, 'BORDADO', GETDATE())
                        `);
                }

                // *** NUEVO: SOPORTE FACTURACIÓN (ServiciosExtraOrden) ***
                // Si la orden es un servicio extra (no principal) o es explícitamente Estampado/Bordado, guardamos item de facturación
                // El usuario pidió explícitamente replicar lógica de Sync para "que me sirva para la facturacion".
                // EXCLUSIÓN DF/DTF/SB: a diferencia de EST/EMB/TWT/TWC (sin archivo, se cobran por
                // esta línea "a mano"), DTF y Sublimación SIEMPRE cotizan por el archivo real
                // (metraje × copias), igual que un pedido de portal normal. Si se le agrega esta
                // línea además del archivo, aparece como un ítem fantasma más para controlar en
                // Planilla/Control — rompe el proceso del área, que tiene que ser IDÉNTICO venga
                // de donde venga el pedido (solo cambian origen/destino, nunca el proceso de
                // impresión). SB entra acá porque "Fabricar a Medida" con Producto Terminado la
                // puede demotear a exec.isExtra=true (deja de ser la principal, pasa a ser
                // hermana de PRO) sin dejar de tener su archivo real.
                // [F1] Impresión Directa y Gran formato son producción principal como SB: también cotizan por el
                // archivo real y también quedan demoteadas a isExtra bajo la PRO del producto terminado. Sin esta
                // exclusión nacía una línea 'Impresión Directa 3.20 - Tela…' que en Control aparecía como un
                // segundo ítem a controlar (2/2, copias contadas dos veces) y en la cotización duplicaba el cobro.
                if ((exec.isExtra && !['DF', 'DTF', ...AREAS_PRINCIPAL_IMPRESION].includes(exec.areaID)) || ['EST', 'EMB', 'TWT', 'TWC'].includes(exec.areaID)) {
                    // Calcular cantidad total (suma de copias o magnitud inicial)
                    let qtyFact = exec.magnitudInicial || 0;
                    // [TPU COMO PORTAL] TPU como servicio de una prenda: sin archivo ni items, la cantidad es prendas × bajadas
                    if (!qtyFact && String(exec.areaID || '').toUpperCase() === 'TPU') qtyFact = (parseInt(exec.metadata?.prendas) || 0) * (parseInt(exec.metadata?.estampadosPorPrenda) || 1);
                    if (qtyFact === 0 && exec.items && exec.items.length > 0) {
                        qtyFact = exec.items.reduce((sum, it) => sum + (parseInt(it.copies) || 1), 0);
                    }
                    if (qtyFact === 0) qtyFact = 1;

                    // Insertar
                    if (exec.codArticulo) {
                        const obsFacturacion = exec.techInfo || 'Generado desde WebOrder';
                        // Estado: SIN forzar 'OK' — nace 'PENDIENTE' (default de la columna), igual
                        // que cualquier archivo/servicio normal. Áreas que todavía usan el Control
                        // clásico (TPU, y cualquier otra que no tenga Bandeja propia) necesitan que
                        // el operario la cuente con el "+1"/tipeado de siempre (FileControlCard) —
                        // si nace en 'OK' esa tarjeta aparece "ya completa" y bloquea tipear o sumar.
                        // EMB/EST/TWT/TWC ya no dependen de este Estado para nada: desde que tienen
                        // su propia Bandeja/Control (aprobarControl), nunca pasan por el guard de
                        // completarOrden que originalmente motivó forzar 'OK' acá.
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Cod', sql.VarChar(50), exec.codArticulo)
                            .input('Stk', sql.VarChar(50), exec.codStock || '')
                            .input('Des', sql.NVarChar(255), `${exec.variante} - ${exec.material}`)
                            .input('Cnt', sql.Decimal(18, 2), qtyFact)
                            .input('Obs', sql.NVarChar(sql.MAX), obsFacturacion)
                            .query(`
                                INSERT INTO ServiciosExtraOrden
                                (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro)
                                VALUES (@OID, @Cod, @Stk, @Des, @Cnt, 0, 0, @Obs, GETDATE())
                            `);
                    }
                }

                // 1. GENERALES Y ESPECIALIZADOS (Siempre a la 1ra orden / Principal)
                if (idx === 0) {
                    // Referencias Generales
                    for (const rf of referenceFiles) {
                        const finalNameRef = `REF-${erpDocNumber}-${sanitizeFileName(rf.name)}`;
                        const resRef = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), rf.type || 'REFERENCIA')
                            .input('Nom', sql.VarChar(200), finalNameRef)
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, @Tipo, @Nom, GETDATE(), 'Pendiente')`);

                        filesToUpload.push({
                            dbId: resRef.recordset[0].RefID,
                            type: 'REF',
                            originalName: rf.name,
                            finalName: finalNameRef,
                            area: 'GENERAL'
                        });
                    }

                    // Especializados
                    for (const sf of specializedFiles) {
                        const finalNameSpec = `SPEC-${erpDocNumber}-${sanitizeFileName(sf.name)}`;
                        const resRef = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), sf.type || 'ESPECIALIZADO')
                            .input('Nom', sql.VarChar(200), finalNameSpec)
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, @Tipo, @Nom, GETDATE(), 'Pendiente')`);

                        filesToUpload.push({
                            dbId: resRef.recordset[0].RefID,
                            type: 'REF',
                            originalName: sf.name,
                            finalName: finalNameSpec,
                            area: 'GENERAL'
                        });
                    }
                }

                // 2. COMPLEMENTARIOS ESPECÍFICOS (Vinculados a su Orden Extra correspondiente)
                // PROTECCION: Solo si NO usamos el nuevo sistema de referencias integradas
                if (exec.isExtra && exec.extraOriginId && selectedComplementary && (!exec.referencias || exec.referencias.length === 0)) {
                    const val = selectedComplementary[exec.extraOriginId];
                    if (val && (val.activo || val.active) && val.archivo && val.archivo.name) {
                        const finalNameComp = `BOCETO-${erpDocNumber}-${exec.extraOriginId}-${sanitizeFileName(val.archivo.name)}`;
                        const resRef = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), 'ARCHIVO DE BOCETO')
                            .input('Nom', sql.VarChar(200), finalNameComp)
                            .input('Not', sql.NVarChar(sql.MAX), val.observacion || val.text || '')
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, NotasAdicionales, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, @Tipo, @Nom, @Not, GETDATE(), 'Pendiente')`);

                        filesToUpload.push({
                            dbId: resRef.recordset[0].RefID,
                            type: 'REF',
                            originalName: val.archivo.name,
                            finalName: finalNameComp,
                            area: 'GENERAL'
                        });
                    }
                }

                // 3. BORDADO (Vinculado específicamente a órdenes de tipo 'EMB')
                // Nota: Si hay una orden explícita de bordado, la usamos. Si no, ¿irían a la principal? 
                // Asumimos que si hay specs, hay orden de bordado.
                if (exec.areaID === 'EMB' && req.body.especificacionesBordado) {
                    const bs = req.body.especificacionesBordado;
                    if (bs.boceto && bs.boceto.name) {
                        const fName = `BOCETO-BORDADO-${erpDocNumber}-${sanitizeFileName(bs.boceto.name)}`;
                        const resRef = await new sql.Request(transaction).input('OID', sql.Int, newOID).input('Nom', sql.VarChar(200), fName).query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, 'ARCHIVO DE BOCETO', @Nom, GETDATE(), 'Pendiente')`);
                        filesToUpload.push({ dbId: resRef.recordset[0].RefID, type: 'REF', originalName: bs.boceto.name, finalName: fName, area: 'GENERAL' });
                    }
                    if (bs.logos && Array.isArray(bs.logos)) {
                        for (const logo of bs.logos) {
                            if (logo.name) {
                                const lName = `LOGO-BORDADO-${erpDocNumber}-${sanitizeFileName(logo.name)}`;
                                const resRef = await new sql.Request(transaction).input('OID', sql.Int, newOID).input('Nom', sql.VarChar(200), lName).query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, 'ARCHIVO DE LOGO', @Nom, GETDATE(), 'Pendiente')`);
                                filesToUpload.push({ dbId: resRef.recordset[0].RefID, type: 'REF', originalName: logo.name, finalName: lName, area: 'GENERAL' });
                            }
                        }
                    }
                }

                // --- SERVICIOS EXTRA (Solo insertar registros, sin archivos) ---
                // (Bloque residual eliminado para limpieza)

            } // Fin loop ejecuciones

            // [PRENDAS] Talles: roster del pedido completo (número/jugador/talle/categoría),
            // ligado a la orden PRINCIPAL (no a los complementarios). Tolera que la tabla
            // OrdenTalles todavía no exista en esta base (falla silenciosa, no aborta el
            // pedido) — mismo criterio que /productos-terminados con TipoStock.
            if (Array.isArray(talles) && talles.length > 0) {
                const principalIdx = pendingOrderExecutions.findIndex(e => !e.isExtra);
                const principalOID = generatedIDs[principalIdx >= 0 ? principalIdx : 0];
                try {
                    for (const t of talles) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, principalOID)
                            .input('Tipo', sql.VarChar(10), t.tipo || 'ADULTO')
                            .input('TSup', sql.VarChar(10), t.talleSup || null)
                            .input('TInf', sql.VarChar(10), t.talleInf || null)
                            .input('Cat', sql.VarChar(30), t.categoria || null)
                            .input('Num', sql.VarChar(10), t.numero || null)
                            .input('Jug', sql.NVarChar(100), t.jugador || null)
                            .input('Nota', sql.NVarChar(300), t.nota || null)
                            .input('Cant', sql.Int, parseInt(t.cantidad, 10) || 1)
                            .query(`
                                INSERT INTO OrdenTalles (OrdenID, Tipo, TalleSup, TalleInf, Categoria, Numero, Jugador, Nota, Cantidad)
                                VALUES (@OID, @Tipo, @TSup, @TInf, @Cat, @Num, @Jug, @Nota, @Cant)
                            `);
                    }
                    logger.info(`[Prendas] ${talles.length} talles guardados para Orden ${principalOID}.`);
                } catch (talleErr) {
                    logger.warn(`[Prendas] No se pudieron guardar los talles (¿falta la tabla OrdenTalles?): ${talleErr.message}`);
                }
            }

            // ACTIVAR AUTOMÁTICAMENTE ORDENES SIN ARCHIVOS PENDIENTES (Ej. Solo Costura)
            for (const oid of generatedIDs) {
                const checkRes = await new sql.Request(transaction)
                    .input('OID', sql.Int, oid)
                    .query(`
                        SELECT 
                            (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo != 'Cancelado') as TotalProd,
                            (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND RutaAlmacenamiento IS NULL AND EstadoArchivo != 'Cancelado') as PendProd,
                            (SELECT COUNT(*) FROM ArchivosReferencia WHERE OrdenID = @OID) as TotalRef,
                            (SELECT COUNT(*) FROM ArchivosReferencia WHERE OrdenID = @OID AND UbicacionStorage = 'Pendiente') as PendRef
                    `);

                if (checkRes.recordset.length > 0) {
                    const { PendProd, PendRef } = checkRes.recordset[0];
                    if ((PendProd + PendRef) === 0) {
                        // Si no hay nada pendiente, activar (solo si sigue en 'Cargando...', preserva el guard original).
                        const { changeOrderState } = require('../services/stateManagerService');
                        const estadoActual = await new sql.Request(transaction)
                            .input('OID', sql.Int, oid)
                            .query(`SELECT Estado FROM Ordenes WHERE OrdenID = @OID`);
                        if (estadoActual.recordset[0]?.Estado === 'Cargando...') {
                            await changeOrderState(transaction, {
                                target : { type: 'ORDER', id: oid },
                                estado : 'Pendiente',
                                userObj: req.user || 'Sistema',
                                detalle: 'Archivos completos, orden activada',
                                io     : req.app.get('socketio'),
                            });
                        }
                    }
                }
            }

            // [COMBOS] FASE 3: por cada componente del combo, su propia venta VEN- de retiro
            // — invisible a producción (EstadoDependencia='VENTA_DIRECTA', mismo criterio que
            // el checkout de la Tienda: "no es trabajo, es un ancla de etiqueta"), visible en
            // Logística/Inventory para despachar. Precio en 0 (el cobro real ya está en la PRO
            // de arriba) — calco de wmsController.createOrder, con dos diferencias: el
            // ProximoServicio se CALCULA desde las áreas reales que este mismo loop ya creó
            // para ese comboItemId (no fijo a DEPOSITO, porque acá SÍ hay decoración que
            // esperar), y ComboPedidoNoDocERP guarda el NoDocERP real del pedido — es lo que
            // usa confirmPreparation para encontrar y liberar el Bordado/DTF real al confirmar
            // esta venta. Misma transacción que el resto del pedido: todo o nada.
            const combosRetiro = Array.isArray(req.body.combosRetiro) ? req.body.combosRetiro : [];
            const ventasCombo = []; // {codigoVenta, pedidoVentaId} — para notificar después del commit
            // [ACCESORIOS] ¿la línea de venta puede guardar de qué depósito del WMS sale? (docs/migrations/configurador_accesorios.sql)
            const conDepLinea = combosRetiro.length
                ? !!(await new sql.Request(transaction).query(`SELECT COL_LENGTH('dbo.PedidosCobranzaDetalle', 'WmsDepositoId') AS c`)).recordset[0].c
                : false;
            for (const item of combosRetiro) {
                if (!item.wmsVarianteId) {
                    logger.warn(`[Prendas] Combo: componente "${item.descripcion}" sin wmsVarianteId — no se genera venta de retiro.`);
                    continue;
                }
                // [ACCESORIOS] un accesorio de stock (mástil, base…) no tiene servicios: su retiro va a PRO
                // (destinoSinServicios), donde Producción lo recibe y sale junto con el producto fabricado.
                const esAccesorio = !!item.esAccesorio;
                const areasComponente = esAccesorio ? new Set() : new Set(
                    pendingOrderExecutions.filter(e => String(e.comboItemId) === String(item.comboItemId)).map(e => e.areaID)
                );
                // [ACCESORIOS] "se cobra aparte": la VEN- lleva el precio de lista del artículo (PreciosBase);
                // "incluido en el precio": $0, como el retiro de un componente (el cobro está en la PRO).
                let precioAcc = 0, monedaAcc = 'UYU';
                if (esAccesorio && String(item.cobro || '').toUpperCase() === 'APARTE' && item.itemProIdProducto) {
                    const pbAcc = await new sql.Request(transaction).input('P', sql.Int, parseInt(item.itemProIdProducto))
                        .query(`SELECT TOP 1 Precio, Moneda FROM dbo.PreciosBase WHERE ProIdProducto = @P ORDER BY UltimaActualizacion DESC`);
                    if (pbAcc.recordset[0]?.Precio != null) {
                        precioAcc = parseFloat(pbAcc.recordset[0].Precio) || 0;
                        monedaAcc = String(pbAcc.recordset[0].Moneda || 'UYU').trim().toUpperCase() === 'USD' ? 'USD' : 'UYU';
                    } else logger.warn(`[Prendas] Accesorio "${item.descripcion}" se cobra aparte pero no tiene precio en PreciosBase — la venta sale en $0.`);
                }
                const cantAcc = parseFloat(item.cantidad) || 1;
                // Mismo criterio que el switch de ProximoServicio de arriba: Bordado trabaja
                // sobre la prenda (va primero); si no hay Bordado pero sí DTF/TPU, la prenda va
                // directo a Estampado (ahí se prensa el transfer, no antes).
                // [VENTA UNA LÍNEA] Un artículo del carrito que no se personaliza no tiene áreas:
                // va a PRO (destinoSinServicios) a juntarse con el resto del pedido, no a Depósito
                // suelto como una venta aparte.
                const proximoAncla = areasComponente.has('EMB') ? 'EMB'
                    : (areasComponente.has('EST') ? 'EST' : (item.destinoSinServicios || 'DEPOSITO'));

                const codigoVenta = await siguienteCodigoVenta(transaction);

                const insertPC = await new sql.Request(transaction)
                    .input('NoDocERP', sql.NVarChar, codigoVenta)
                    .input('ClienteID', sql.Int, cliIdCliente || null)
                    .input('Monto', sql.Decimal(18, 2), Math.round(precioAcc * cantAcc * 100) / 100)
                    .input('Mon', sql.NVarChar, monedaAcc)
                    .query(`
                        INSERT INTO PedidosCobranza (NoDocERP, ClienteID, MontoTotal, Moneda, FechaGeneracion, EstadoCobro)
                        OUTPUT INSERTED.ID
                        VALUES (@NoDocERP, @ClienteID, @Monto, @Mon, GETDATE(), 'PENDIENTE')
                    `);
                const pedidoVentaId = insertPC.recordset[0].ID;

                const insertAncla = await new sql.Request(transaction)
                    .input('Cliente', sql.NVarChar(200), nombreCliente)
                    .input('CliId', sql.Int, cliIdCliente || null)
                    // [VENTA x ITEM] La misma ancla sirve para un componente de combo y para un
                    // artículo del carrito de "Comprar y personalizar" — solo cambia cómo se
                    // llama en la pantalla de Logística.
                    .input('Desc', sql.NVarChar(300), `${item.etiqueta || 'RETIRO COMBO'} — ${item.descripcion}`)
                    .input('Mat', sql.VarChar(255), item.descripcion || 'Combo')
                    .input('Cod', sql.VarChar(50), codigoVenta)
                    .input('Doc', sql.VarChar(50), codigoVenta)
                    .input('Mag', sql.VarChar(50), String(item.cantidad || 1))
                    .input('Prox', sql.VarChar(50), proximoAncla)
                    .input('Wms', sql.Int, parseInt(item.wmsVarianteId))
                    .input('CI', sql.Int, parseInt(item.comboItemId))
                    .input('PedidoOrigen', sql.NVarChar(50), erpDocNumber)
                    .query(`
                        INSERT INTO Ordenes (
                            AreaID, Cliente, CliIdCliente, DescripcionTrabajo, Prioridad,
                            FechaIngreso, FechaEstimadaEntrega, Material, CodigoOrden, NoDocERP,
                            Magnitud, ProximoServicio, UM, Estado, EstadoenArea,
                            WmsVarianteId, EstadoDependencia, ComboItemID, ComboPedidoNoDocERP
                        )
                        OUTPUT INSERTED.OrdenID
                        VALUES (
                            'PRO', @Cliente, @CliId, @Desc, 'Normal',
                            GETDATE(), DATEADD(day, 3, GETDATE()), @Mat, @Cod, @Doc,
                            @Mag, @Prox, 'u', 'Pendiente', 'Pendiente',
                            @Wms, 'VENTA_DIRECTA', @CI, @PedidoOrigen
                        )
                    `);
                const anclaOrdenId = insertAncla.recordset[0].OrdenID;
                try { await calcularFechasOrden(transaction, anclaOrdenId); }
                catch (feErr) { logger.error(`⚠️ calcularFechasOrden falló para OrdenID ${anclaOrdenId} (ancla combo): ${feErr.message}`); }

                await new sql.Request(transaction)
                    .input('PID', sql.Int, pedidoVentaId)
                    .input('OID', sql.Int, anclaOrdenId)
                    .input('CodArt', sql.NVarChar, String(item.wmsVarianteId))
                    // [COMBOS] Sin ProIdProducto, la vista de Logística (getPendingOrders,
                    // JOIN a Articulos por ProIdProducto) no resuelve el nombre del artículo y
                    // muestra "null - <variante>" en la tarjeta.
                    .input('ProId', sql.Int, item.itemProIdProducto ? parseInt(item.itemProIdProducto) : null)
                    .input('Cant', sql.Decimal(18, 2), cantAcc)
                    .input('PU', sql.Decimal(18, 2), precioAcc)
                    .input('Sub', sql.Decimal(18, 2), Math.round(precioAcc * cantAcc * 100) / 100)
                    .input('MonD', sql.NVarChar, monedaAcc)
                    // [ACCESORIOS] depósito del WMS de donde se retira (NULL = el de ventas)
                    .input('Dep', sql.Int, esAccesorio && parseInt(item.wmsDepositoId) > 0 ? parseInt(item.wmsDepositoId) : null)
                    .query(`
                        INSERT INTO PedidosCobranzaDetalle
                        (PedidoCobranzaID, OrdenID, CodArticulo, ProIdProducto, Cantidad, PrecioUnitario, Subtotal, Moneda, DatoTecnico${conDepLinea ? ', WmsDepositoId' : ''})
                        VALUES (@PID, @OID, @CodArt, @ProId, @Cant, @PU, @Sub, @MonD, 0${conDepLinea ? ', @Dep' : ''})
                    `);

                ventasCombo.push({ codigoVenta, pedidoVentaId });
            }

            await transaction.commit();

            // [BORDADO] Matriz automática (BORRADOR) en segundo plano, igual que el pedido del portal:
            // queda en Archivos de Referencia; no cumple el requisito MATRIZ.
            try {
                const bordadoMatrizService = require('../services/bordadoMatrizService');
                if (bordadoMatrizService.habilitado()) {
                    ordenesMatrizAuto.forEach(ordenId => bordadoMatrizService.encolarGeneracion({ ordenId }));
                }
            } catch (bordadoErr) {
                logger.error(`[Bordado-Matriz] no se pudo encolar la generación: ${bordadoErr.message}`);
            }

            // [COMBOS] Trazabilidad + aviso a la Print Station por cada venta de retiro —
            // best-effort, fuera de la transacción: la venta ya quedó confirmada arriba.
            for (const v of ventasCombo) {
                try {
                    const { logEvento } = require('./logisticaWmsController');
                    await logEvento(pool, v.pedidoVentaId, { estado: 'PENDIENTE', usuario: nombreCliente });
                } catch (eEv) { /* sin trazabilidad no se corta la venta */ }
            }
            if (ventasCombo.length > 0) {
                const ioInst = req.app?.get('socketio');
                if (ioInst) {
                    ventasCombo.forEach(v => {
                        ioInst.emit('wms:pedido', { type: 'nuevo_pedido', pedidoId: v.pedidoVentaId, codigoVenta: v.codigoVenta });
                    });
                    logger.info(`[Prendas] 📡 ${ventasCombo.length} venta(s) de retiro de combo notificada(s) a la Print Station.`);
                }
            }

            // RESPUESTA AL FRONTEND: "Orden Creada, Ahora Sube los Archivos"
            res.json({
                success: true,
                orderIds: generatedOrders,
                requiresUpload: filesToUpload.length > 0,
                uploadManifest: filesToUpload
            });

            // --- AUTO-COTIZACIÓN ASÍNCRONA ---
            // Disparar el cálculo de precios en segundo plano para que la orden
            // aparezca cotizada en Caja sin requerir un sync manual del ERP.
            // Calcula y guarda en PedidosCobranza para que sea visible en el panel de Caja.
            setImmediate(async () => {
                try {
                    logger.info(`[WebOrder] 🔢 Iniciando auto-cotización para NoDocERP=${erpDocNumber}...`);
                    await ERPSyncService.syncFinalOrderIntegration(
                        erpDocNumber,
                        req.user?.id || 1,
                        req.user?.name || nombreCliente
                    );
                    logger.info(`[WebOrder] ✅ Auto-cotización completada para NoDocERP=${erpDocNumber}.`);
                } catch (syncErr) {
                    logger.warn(`[WebOrder] ⚠️ Auto-cotización falló para ${erpDocNumber} (no crítico): ${syncErr.message}`);
                }
                // [FICHA DEL PEDIDO] Con orden madre PRO, la ficha PDF (pedido + configuración del producto +
                // órdenes + archivos) se pega a la PRO como referencia. Después de cotizar, así sale con precio.
                // Si el pedido viene de una solicitud, esa ya adjunta la suya y esta no duplica.
                try { await require('../services/fichaPedidoPdf').adjuntarAlPedido(erpDocNumber, req.user, req.app); }
                catch (fichaErr) { logger.warn(`[FICHA-PEDIDO] ${erpDocNumber}: ${fichaErr.message}`); }
            });

        } catch (dbErr) {
            if (transaction) await transaction.rollback();
            throw dbErr;
        }

    } catch (err) {
        logger.error("❌ Error creando estructura de pedido:", err);
        res.status(500).json({ error: "Error iniciando pedido: " + err.message });
    }
};

// getExternalToken removido - ya no se usa, los pagos se registran directamente en DB

// ══════════════════════════════════════════════════════════════
// ─── MERCADOPAGO ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

