const contabilidadService = require('../services/contabilidadService');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { changeOrderState } = require('../services/stateManagerService');
const { isPedidoCompletoEnArea, isPedidoCompletoGlobal, sqlExistsHermanaNoPronta, hermanasSinBultoPropio } = require('../services/pedidoCompletoService');
const { totalesCobranzaDeOrden, importeOrdenParaDeposito, ordenHermanaSinCargo } = require('../utils/montoTotalPedido');
// Spec 39: libro de entregas por orden (envío parcial, complementos, candado de Depósito sobre el libro)
const libroEntregas = require('../services/libroEntregasService');
const linajeOrdenes = require('../services/linajeOrdenesService');
const reposicionesService = require('../services/reposicionesService');
// Qué bultos espera el depósito de un pedido (misma regla en la recepción y en la bandeja)
const bultosPedido = require('../services/bultosPedidoService');

// [PRENDAS] "Comprar y personalizar": Bordado/DTF/TPU/Estampado/Corte/Costura que cuelgan
// de una orden madre PRO (prenda comprada + personalizaciones, un solo precio) son trabajo
// interno — mismo trato que la hermana TERMINAC de ECOUV: no generan fila propia en
// OrdenesDeposito, así que no se cobran aparte ni disparan su propio WhatsApp. Solo la
// orden PRO cobra/avisa.
const esHermanaDePrendaPersonalizada = async (pool, codigoOrden) => {
    if (!codigoOrden) return false;
    try {
        const r = await pool.request()
            .input('Cod', require('mssql').VarChar, codigoOrden)
            .query(`
                SELECT TOP 1 1 AS X
                FROM Ordenes o
                JOIN Ordenes madre ON madre.NoDocERP = o.NoDocERP AND madre.AreaID = 'PRO'
                WHERE o.CodigoOrden = @Cod AND o.AreaID IN ('EMB', 'DF', 'TPU', 'EST', 'TWC', 'TWT', 'SB', 'DIRECTA', 'ECOUV')   -- [F1] misma lista que erpSync/LabelGenerationService
            `);
        return r.recordset.length > 0;
    } catch (e) {
        logger.warn('[Prendas] esHermanaDePrendaPersonalizada:', e.message);
        return false;
    }
};

// [PRENDAS] A qué orden corresponde REALMENTE el registro de OrdenesDeposito: si la orden
// que llega a Depósito es una hermana (EMB/DF/TPU/EST/TWC/TWT) de una PRO, hay que
// REDIRIGIR el registro a la madre — no simplemente omitirlo. Con varias hermanas
// convergiendo por separado (ej. Estampado partido en 1/2 y 2/2, cada una con su propio
// check-in), si la hermana se limita a excluirse sin redirigir, cuando la ÚLTIMA en llegar
// es justo una hermana, nada crea el registro y el pedido entero se queda sin cobrar ni
// avisar. Las llamadas siguientes (de otras hermanas del mismo pedido) van a encontrar el
// registro de la madre ya creado — el checkeo "existe" de cada call site sigue funcionando
// igual, solo que ahora busca por el CodigoOrden de la madre en vez del de la hermana.
// Devuelve null si no hay hermana que redirigir (orden normal, sigue su propio camino) o si
// es hermana pero no se pudo resolver la madre (más seguro no crear nada que facturar mal).
const resolverOrdenParaDeposito = async (pool, ordenId, codigoOrden) => {
    const esHermana = await esHermanaDePrendaPersonalizada(pool, codigoOrden);
    if (!esHermana) return { ordenId, codigoOrden };
    try {
        const r = await pool.request()
            .input('OID', require('mssql').Int, ordenId)
            .query(`
                SELECT TOP 1 madre.OrdenID, madre.CodigoOrden, madre.CliIdCliente, madre.CodCliente,
                       madre.DescripcionTrabajo, madre.ProIdProducto, madre.Magnitud
                FROM Ordenes o
                JOIN Ordenes madre ON madre.NoDocERP = o.NoDocERP AND madre.AreaID = 'PRO'
                WHERE o.OrdenID = @OID
            `);
        if (r.recordset.length > 0) {
            const m = r.recordset[0];
            return {
                ordenId: m.OrdenID, codigoOrden: m.CodigoOrden,
                cliIdCliente: m.CliIdCliente, codCliente: m.CodCliente,
                descripcionTrabajo: m.DescripcionTrabajo, proIdProducto: m.ProIdProducto,
                magnitud: m.Magnitud,
            };
        }
    } catch (e) {
        logger.warn('[Prendas] resolverOrdenParaDeposito:', e.message);
    }
    return null;
};

// El CliIdCliente REAL para depósito/contabilidad — NUNCA el CodCliente crudo.
// El viejo fallback `CliIdCliente || CodCliente` metía el CÓDIGO del cliente en la
// columna CliIdCliente cuando el id no venía resuelto (p.ej. cliente eliminado), y
// nacían registros huérfanos incobrables con un id inexistente (caso Carlos Benechi,
// 26-ago-2026: 2 órdenes en depósito con CliIdCliente=5714745 — su CodCliente).
// Si el id directo no viene, se resuelve por CodCliente contra Clientes; si el
// cliente no existe, devuelve null y el llamador OMITE el asiento/registro dejando
// el error en el log (mejor un ingreso visiblemente incompleto que basura silenciosa).
const resolverCliPK = async (pool, cliIdDirecto, codCliente) => {
    const directo = parseInt(cliIdDirecto);
    if (directo > 0) return directo;
    const cod = parseInt(codCliente);
    if (!(cod > 0)) return null;
    const r = await pool.request()
        .input('Cod', require('mssql').Int, cod)
        .query('SELECT CliIdCliente FROM Clientes WITH(NOLOCK) WHERE CodCliente = @Cod');
    return r.recordset[0]?.CliIdCliente ?? null;
};

// Qué hay asentado de una orden y de su pedido. El ingreso a Depósito lo usa para decidir si
// asienta la orden. Desde el 23/07/2026 cada orden asienta SOLO SUS líneas del pedido, así que
// "ya asentada" también tiene que ser por orden: con la marca del pedido (MontoContabilizado),
// la primera parte de un pedido dividido "(n/m)" lo dejaba marcado y las demás partes entraban
// sin cargo en la cuenta ni descuento del plan (209 pedidos entre el 23/07 y el 30/09).
// MovimientosCuenta.OrdIdOrden puede ser Ordenes.OrdenID o OrdenesDeposito.OrdIdOrden según
// quién creó el movimiento: se buscan los dos, siempre acotado al MISMO cliente.
//   propios       → movimientos vivos de asiento (ORDEN, ORDEN_ANTICIPO, ENTREGA, CONSUMO_CUENTA) de ESTA orden.
//   lineasPropias → líneas de ESTA orden en el pedido (sin las "Incluido en PRO").
//   cargadoPedido → plata cargada (ORDEN/ORDEN_ANTICIPO vivas, sin los espejos CUBIERTO de la
//                   billetera) a TODAS las órdenes del pedido, en la moneda del pedido.
const estadoAsientoOrden = async (pool, { ordenId, codigoOrden, cliId, pedidoId, noDocERP, monId }) => {
    const r = await pool.request()
        .input('OID', sql.Int, ordenId)
        .input('Cod', sql.VarChar(100), String(codigoOrden || '').trim())
        .input('Cli', sql.Int, cliId)
        .input('PID', sql.Int, pedidoId)
        .input('Doc', sql.VarChar(50), String(noDocERP || '').trim())
        .input('Mon', sql.Int, monId)
        .query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK)
                WHERE d.OrdenID = @OID AND d.PedidoCobranzaID = @PID AND ISNULL(d.EsHermanaConsolidada, 0) = 0
              ) AS LineasPropias,
              (SELECT COUNT(*) FROM dbo.PedidosCobranzaDetalle d WITH(NOLOCK)
                WHERE d.PedidoCobranzaID = @PID AND d.OrdenID IS NOT NULL
              ) AS LineasConOrden,
              (SELECT COUNT(*) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                 JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = @Cli
                WHERE m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO', 'ENTREGA', 'CONSUMO_CUENTA')
                  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND (m.OrdIdOrden = @OID
                       OR m.OrdIdOrden IN (SELECT od.OrdIdOrden FROM dbo.OrdenesDeposito od WITH(NOLOCK) WHERE od.OrdCodigoOrden = @Cod))
              ) AS Propios,
              (SELECT ISNULL(SUM(ABS(m.MovImporte)), 0) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                 JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = @Cli
                  -- Hay cuentas de dinero con MonIdMoneda en NULL: la moneda sale del tipo de cuenta
                  AND COALESCE(cc.MonIdMoneda, CASE cc.CueTipo WHEN 'DINERO_USD' THEN 2 WHEN 'DINERO_UYU' THEN 1 END) = @Mon
                WHERE m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
                  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND ISNULL(m.MovObservaciones, '') NOT LIKE 'CUBIERTO%'
                  AND m.OrdIdOrden IN (
                        SELECT o.OrdenID FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.NoDocERP = @Doc
                        UNION
                        SELECT od.OrdIdOrden FROM dbo.OrdenesDeposito od WITH(NOLOCK)
                          JOIN dbo.Ordenes o WITH(NOLOCK) ON o.CodigoOrden = od.OrdCodigoOrden
                         WHERE o.NoDocERP = @Doc)
              ) AS CargadoPedido`);
    const row = r.recordset[0] || {};
    return {
        propios: Number(row.Propios) || 0,
        lineasPropias: Number(row.LineasPropias) || 0,
        lineasConOrden: Number(row.LineasConOrden) || 0,
        cargadoPedido: Number(row.CargadoPedido) || 0,
    };
};

/**
 * Valida la regla de pedido completo para un conjunto de órdenes a despachar/recibir:
 *  - destino DEPOSITO  → el pedido debe estar completo GLOBALMENTE (todas las áreas).
 *  - destino otra área → el pedido debe estar completo EN EL ÁREA de la orden.
 * Lanza Error (statusCode 400) con el detalle de las órdenes faltantes.
 */
const validarPedidosCompletos = async (db, ordenes, areaDestino) => {
    const pedidosChequeados = new Set();
    for (const ord of ordenes) {
        if (!ord.NoDocERP) continue;
        const key = `${ord.NoDocERP}|${ord.AreaID || ''}`;
        if (pedidosChequeados.has(key)) continue;
        pedidosChequeados.add(key);

        const chk = (areaDestino === 'DEPOSITO')
            ? await isPedidoCompletoGlobal(db, ord.NoDocERP)
            : await isPedidoCompletoEnArea(db, ord.NoDocERP, ord.AreaID);

        if (!chk.completo) {
            const detalle = chk.faltantes
                .map(f => `${f.CodigoOrden} (${f.EstadoenArea || f.Estado || 'Pendiente'})`)
                .join(', ');
            const err = new Error(
                `Pedido ${ord.NoDocERP} incompleto${areaDestino === 'DEPOSITO' ? '' : ` en ${ord.AreaID}`}: faltan ${detalle}. ` +
                `No se puede ${areaDestino === 'DEPOSITO' ? 'enviar/recibir en DEPOSITO' : 'despachar'} hasta que el pedido esté completo.`
            );
            err.statusCode = 400;
            throw err;
        }
    }
    // Spec 39 (RN-FLT.12 / INV-FLT.01): hacia DEPOSITO el pedido además tiene que estar
    // completo en el LIBRO DE ENTREGAS: ninguna orden con envío parcial sin cerrar, ninguna
    // reposición abierta, ninguna solicitud de insumo abierta. Es un motivo, no un número.
    if (areaDestino === 'DEPOSITO') await validarLibroParaDeposito(db, ordenes);
};

/**
 * Candado de Depósito sobre el libro de entregas (Spec 39). Lanza 400 con el detalle exacto
 * de qué orden está incompleta y por qué (qué reposición, en qué área, en qué estado).
 */
const validarLibroParaDeposito = async (db, ordenes) => {
    const pedidos = [...new Set((ordenes || []).map(o => o.NoDocERP).filter(Boolean).map(n => String(n).trim()))];
    for (const noDoc of pedidos) {
        const incompletas = await libroEntregas.ordenesIncompletasPedido(noDoc, db);
        if (incompletas.length > 0) {
            const detalle = incompletas.map(i => `${String(i.CodigoOrden).trim()} (${i.motivos.join('; ') || 'incompleta'})`).join(' · ');
            const err = new Error(`El pedido ${noDoc} no puede ir a DEPOSITO: tiene órdenes incompletas. ${detalle}. Se libera solo cuando no quede ninguna reposición abierta y todas las órdenes tengan su último envío.`);
            err.statusCode = 400;
            throw err;
        }
    }
};

/**
 * Arma las líneas por orden de un remito (Spec 39, RN-FLT.01 a 04).
 *  - Una línea por orden madre de producto terminado. Un bulto de una orden de falla con registro
 *    en Reposiciones viaja como COMPLEMENTO de su madre (línea con OrdenOrigenID/ReposicionID).
 *  - "Completa la orden": sin parcial habilitado, sale completa salvo que tenga una reposición
 *    abierta (nunca se marca completa con una abierta). Con parcial, manda lo que declaró el
 *    operario; si no declaró nada, completa cuando no quedan bultos en el área ni reposiciones abiertas.
 *  - Cantidad: opcional; obligatoria y acotada a lo esperado donde se cuentan prendas o unidades.
 * Devuelve { lineasFinales, ordenesSinCompletar } — las madres que NO pasan a "En transito".
 */
const armarLineasRemito = async (transaction, { dispatchedOrders, bultosPorOrden, lineasOrden, permiteParcial, areaOrigen, areaDestino }) => {
    const lineasFinales = [];
    const ordenesSinCompletar = new Set();
    if (!dispatchedOrders || dispatchedOrders.size === 0) return { lineasFinales, ordenesSinCompletar };
    const declaradas = Array.isArray(lineasOrden) ? lineasOrden : [];
    const err400 = (msg) => { const e = new Error(msg); e.statusCode = 400; return e; };

    const infoRes = await new sql.Request(transaction).query(`
        SELECT o.OrdenID, o.CodigoOrden, o.AreaID, o.UM, o.NoDocERP, o.EstadoEnvio, o.Magnitud, o.CantidadEsperada
        FROM Ordenes o WHERE o.OrdenID IN (${[...dispatchedOrders].map(Number).filter(n => !isNaN(n)).join(',')})`);
    if (!infoRes.recordset.length) return { lineasFinales, ordenesSinCompletar };
    const areasUnidades = await libroEntregas.areasQueCuentanUnidades(transaction);

    // Agrupar por orden madre: la madre misma y/o las reposiciones que viajan como complemento
    const porMadre = new Map();
    for (const info of infoRes.recordset) {
        if (!(bultosPorOrden.get(info.OrdenID) > 0)) continue; // solo producto terminado
        const rep = await linajeOrdenes.getReposicionDeFalla(info.OrdenID, transaction);
        const madreId = rep ? Number(rep.OrdenMadreID) : Number(info.OrdenID);
        if (!porMadre.has(madreId)) porMadre.set(madreId, { madre: null, origenes: [] });
        const g = porMadre.get(madreId);
        if (rep) g.origenes.push({ ordenId: info.OrdenID, reposicionId: rep.ReposicionID, codigo: info.CodigoOrden, bultos: bultosPorOrden.get(info.OrdenID) || 0 });
        else g.madre = info;
    }

    for (const [madreId, g] of porMadre) {
        let madre = g.madre;
        if (!madre) {
            const m = await new sql.Request(transaction).input('id', sql.Int, madreId)
                .query(`SELECT OrdenID, CodigoOrden, AreaID, UM, NoDocERP, EstadoEnvio, Magnitud, CantidadEsperada FROM Ordenes WHERE OrdenID = @id`);
            madre = m.recordset[0];
            if (!madre) continue;
        }
        const codigo = String(madre.CodigoOrden || madreId).trim();
        const declarada = declaradas.find(l => Number(l.ordenId) === madreId) || null;
        if (declarada && areaDestino === 'DEPOSITO' && declarada.completaOrden === false) {
            throw err400(`${codigo}: un envío parcial nunca puede tener destino DEPOSITO. A Depósito solo va el pedido completo.`);
        }

        // Reposiciones abiertas de la madre, sin contar las que viajan en este mismo remito.
        const puede = await libroEntregas.puedeCompletar(madreId, transaction, { incluirImplicitas: permiteParcial });
        const abiertasRestantes = puede.reposicionesAbiertas.filter(r => !g.origenes.some(o => Number(o.reposicionId) === Number(r.ReposicionID)));
        const sinAbiertas = abiertasRestantes.length === 0;
        const detalleAbiertas = abiertasRestantes.map(r => `${r.CodigoFalla || 'reposición sin orden'} (${libroEntregas.describirReposicion(r)})`).join(', ');

        let completa;
        if (!permiteParcial) {
            completa = sinAbiertas;
        } else if (declarada && declarada.completaOrden != null) {
            completa = !!declarada.completaOrden;
            if (completa && !sinAbiertas) {
                throw err400(`No se puede marcar ${codigo} como completa: quedan reposiciones abiertas: ${detalleAbiertas}. Mandala como envío parcial.`);
            }
        } else {
            const rem = await new sql.Request(transaction)
                .input('OID', sql.Int, madreId).input('AreaOrig', sql.VarChar, areaOrigen || '')
                .query(`SELECT COUNT(*) AS n FROM Logistica_Bultos WHERE OrdenID = @OID AND Tipocontenido = 'PROD_TERMINADO' AND Estado = 'EN_STOCK' AND UbicacionActual = @AreaOrig`);
            completa = (rem.recordset[0]?.n || 0) === 0 && sinAbiertas;
        }

        // Cantidad
        const cuentaUnidades = areasUnidades.includes(String(madre.AreaID || '').trim().toUpperCase());
        // Complemento PURO (solo bulto(s) de reposición, sin bulto propio de la madre en este
        // remito): su cantidad es la de LA REPOSICIÓN — una reproducción por una falla, fuera
        // del total original de la madre — no "lo que falta para llegar a lo esperado" de ella.
        // Validarla contra cantidadEsperada/enviada de la madre rechaza cualquier reposición
        // sobre una madre que ya salió completa (el caso normal: la falla se descubre después).
        const esComplementoPuro = !g.madre && g.origenes.length > 0;
        let cantidad = declarada && declarada.cantidad != null && declarada.cantidad !== '' ? Number(declarada.cantidad) : null;
        if (cantidad != null && !(cantidad > 0)) throw err400(`${codigo}: la cantidad del envío tiene que ser mayor que cero.`);
        if (cuentaUnidades && !esComplementoPuro) {
            const esperada = libroEntregas.cantidadEsperada(madre);
            const envios = await libroEntregas.getEnviosOrden(madreId, transaction);
            const enviada = envios.reduce((s, e) => s + (e.Cantidad != null ? Number(e.Cantidad) : 0), 0);
            if (cantidad == null && !completa && permiteParcial) {
                throw err400(`${codigo}: en ${String(madre.AreaID).trim()} la cantidad del envío parcial es obligatoria (se cuentan ${String(madre.UM || 'unidades').trim()}).`);
            }
            if (cantidad == null && completa && esperada) cantidad = Math.max(esperada - enviada, 0) || null;
            if (cantidad != null && esperada && enviada + cantidad > esperada + 0.001) {
                throw err400(`${codigo}: no se pueden enviar ${cantidad} ${String(madre.UM || '').trim()}: lo esperado es ${esperada} y ya salieron ${enviada}.`);
            }
        } else if (cuentaUnidades && esComplementoPuro && cantidad == null) {
            // Auto-completar desde la propia orden de falla (CantidadAprobadaBultos, o su
            // Magnitud si nunca pasó por Control) — NO desde la madre. Sin dato en ninguna,
            // se deja null y sigue sin bloquear (mismo criterio "sin dato no se valida" que
            // el resto del sistema), en vez de exigirle al operario que la tipee a mano.
            let suma = 0, huboDato = false;
            for (const o of g.origenes) {
                const r = await new sql.Request(transaction).input('id', sql.Int, o.ordenId)
                    .query(`SELECT CantidadAprobadaBultos, Magnitud FROM Ordenes WHERE OrdenID = @id`);
                const row = r.recordset[0];
                const val = row?.CantidadAprobadaBultos != null ? parseFloat(row.CantidadAprobadaBultos) : (parseFloat(row?.Magnitud) || null);
                if (val != null) { suma += val; huboDato = true; }
            }
            if (huboDato && suma > 0) cantidad = suma;
        }
        const motivo = completa ? null : ((declarada && declarada.motivoPendiente) || (sinAbiertas ? 'RESTO_EN_PRODUCCION' : 'FALLA_EN_PROCESO'));

        const lineasMadre = [];
        if (g.madre) lineasMadre.push({ ordenId: madreId, bultos: bultosPorOrden.get(madreId) || 0 });
        for (const o of g.origenes) lineasMadre.push({ ordenId: madreId, ordenOrigenId: o.ordenId, reposicionId: o.reposicionId, esComplemento: true, bultos: o.bultos });
        lineasMadre.forEach((l, i) => {
            const ultima = i === lineasMadre.length - 1;
            lineasFinales.push({ ...l, completaOrden: completa && ultima, cantidad: ultima ? cantidad : null, unidad: madre.UM, motivoPendiente: ultima ? motivo : null });
        });
        if (!completa) ordenesSinCompletar.add(madreId);
    }
    return { lineasFinales, ordenesSinCompletar };
};



// Helper para registrar movimientos históricos
const registrarMovimiento = async (transaction, { codigoBulto, tipo, area, usuario, obs, estAnt, estNew, esRecep }) => {
    try {
        await new sql.Request(transaction)
            .input('Cod', sql.VarChar, codigoBulto)
            .input('Tipo', sql.VarChar, tipo)
            .input('Area', sql.VarChar, area)
            .input('User', sql.Int, usuario || 1)
            .input('Obs', sql.NVarChar, obs || '')
            .input('ant', sql.VarChar, estAnt || null)
            .input('nue', sql.VarChar, estNew || null)
            .input('recep', sql.Bit, esRecep ? 1 : 0)
            .query(`
                INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
                VALUES (@Cod, @Tipo, @Area, @User, GETDATE(), @Obs, @ant, @nue, @recep)
            `);
    } catch (e) {
        logger.error("Error registrando movimiento:", e);
    }
};

// Helpers
const normalize = (s) => (s || '').toString().trim().toUpperCase();

function getNextStep(pipelineStr, currentStep) {
    if (!pipelineStr) return 'DEPOSITO';
    const steps = pipelineStr.split(/[\/-]/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!currentStep) return steps[0];
    const curr = currentStep.toUpperCase();
    const idx = steps.findIndex(s => s === curr || s.includes(curr));
    if (idx >= 0 && idx < steps.length - 1) {
        return steps[idx + 1];
    }
    return 'DEPOSITO';
}

// ==========================================
// 1. LEGACY / BATCH LOGIC (Mantenida por compatibilidad)
// ==========================================

exports.validateBatch = async (req, res) => {
    const { codes, areaId, type } = req.body; // type: 'INGRESO' | 'EGRESO'
    const results = [];

    try {
        const pool = await getPool();

        for (const code of codes) {
            if (!code || !code.trim()) continue;
            const codNorm = normalize(code);
            let entity = null;

            // Identificar origen (Recepcion vs Orden)
            if (codNorm.startsWith('PRE')) {
                const r = await pool.request().input('C', sql.VarChar, codNorm)
                    .query("SELECT * FROM Recepciones WHERE Codigo = @C");
                entity = r.recordset[0];
            } else {
                const r = await pool.request().input('C', sql.VarChar, codNorm)
                    .query("SELECT * FROM Ordenes WHERE CodigoOrden = @C");
                entity = r.recordset[0];
            }

            const out = {
                orden: code,
                isValid: false,
                message: '',
                entity: entity ? {
                    Estado: entity.Estado,
                    Ubicacion: entity.UbicacionActual,
                    Proximo: entity.ProximoServicio
                } : null
            };

            if (!entity) {
                // Check if it exists in Logistica_Bultos (New System)
                const bultoCheck = await pool.request().input('C', sql.VarChar, codNorm)
                    .query("SELECT UbicacionActual, Estado FROM Logistica_Bultos WHERE CodigoEtiqueta = @C");

                if (bultoCheck.recordset.length > 0) {
                    const b = bultoCheck.recordset[0];
                    out.entity = { Ubicacion: b.UbicacionActual, Estado: b.Estado };
                    // Apply generic logic regarding location
                    if (type === 'INGRESO') {
                        if (normalize(b.UbicacionActual) === normalize(areaId)) {
                            out.message = 'Ya está en el área';
                            out.isValid = true;
                        } else {
                            out.message = `Viene de ${b.UbicacionActual}`;
                            out.isValid = true;
                        }
                    } else {
                        // EGRESO
                        if (normalize(b.UbicacionActual) !== normalize(areaId)) {
                            out.message = `No está en esta área (${b.UbicacionActual})`;
                            out.isValid = false;
                        } else {
                            out.message = 'Listo para despachar';
                            out.isValid = true;
                        }
                    }
                } else {
                    // Not found anywhere
                    if (type === 'INGRESO') {
                        out.isValid = true;
                        out.message = 'Nuevo Ingreso (No registrado)';
                        out.isNew = true;
                    } else {
                        out.isValid = false;
                        out.message = 'No existe en base de datos';
                    }
                }
            } else {
                // Legacy Logic for Orders/Recepciones
                const ubicacion = normalize(entity.UbicacionActual);
                const estado = normalize(entity.Estado);
                const area = normalize(areaId);

                if (type === 'INGRESO') {
                    if (ubicacion === area && estado !== 'EN TRANSITO') {
                        out.isValid = true;
                        out.message = 'Ya está en el área ' + estado;
                    } else if (estado === 'EN TRANSITO') {
                        out.isValid = true;
                        out.message = 'Listo para recibir';
                    } else {
                        out.isValid = true;
                        out.message = `Viene de ${ubicacion} (${estado})`;
                    }
                } else { // EGRESO
                    if (ubicacion !== area && estado !== 'INGRESO' && estado !== 'EN PROCESO' && estado !== 'RECEPCIONADO') {
                        out.isValid = false;
                        out.message = `No está en esta área (Está en ${ubicacion})`;
                    } else if (estado === 'EN TRANSITO') {
                        out.isValid = false;
                        out.message = 'Ya fue despachado (En Transito)';
                    } else {
                        out.isValid = true;
                        const pipeline = entity.Detalle || entity.Servicios || '';
                        out.nextService = getNextStep(pipeline, area);
                        out.message = 'Listo para despachar -> ' + out.nextService;
                    }
                }
            }
            results.push(out);
        }
        res.json({ results });
    } catch (err) {
        logger.error("Error validateBatch:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.processBatch = async (req, res) => {
    const { movements, areaId, type, usuarioId } = req.body;
    const processed = [];

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const mov of movements) {
                const codNorm = normalize(mov.orden);
                let isRecepcion = codNorm.startsWith('PRE');

                // Update Legacy Tables
                let nuevoEstado = (type === 'INGRESO') ? (areaId === 'LOCAL' ? 'PRONTO PARA ENTREGAR' : 'EN PROCESO') : 'EN TRANSITO';
                let nuevaUbicacion = areaId;

                // ALSO Update Logistica_Bultos if exists
                await new sql.Request(transaction)
                    .input('Est', sql.VarChar, (type === 'INGRESO') ? 'EN_STOCK' : 'EN_TRANSITO')
                    .input('Ubi', sql.VarChar, areaId)
                    .input('Cod', sql.VarChar, codNorm)
                    .query(`UPDATE Logistica_Bultos SET Estado = @Est, UbicacionActual = @Ubi WHERE CodigoEtiqueta = @Cod`);

                // Update Ordenes/Recepciones (dominio logística: estado propio, NO pasa por el servicio de estados de producción)
                const qryUpdate = isRecepcion
                    ? `UPDATE Recepciones SET Estado = @Est, UbicacionActual = @Ubi WHERE Codigo = @Cod`
                    : `UPDATE Ordenes SET Estado = @Est, UbicacionActual = @Ubi WHERE CodigoOrden = @Cod`;

                await new sql.Request(transaction)
                    .input('Est', sql.VarChar, nuevoEstado)
                    .input('Ubi', sql.VarChar, nuevaUbicacion)
                    .input('Cod', sql.VarChar, codNorm)
                    .query(qryUpdate);

                // Log Legacy
                await new sql.Request(transaction)
                    .input('Cod', sql.VarChar, codNorm)
                    .input('Tipo', sql.VarChar, type)
                    .input('Area', sql.VarChar, areaId)
                    .input('UID', sql.Int, usuarioId)
                    .input('Obs', sql.NVarChar, mov.observaciones || '')
                    .query(`INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones) VALUES (@Cod, @Tipo, @Area, @UID, @Obs)`);

                processed.push({ orden: codNorm, estado: nuevoEstado });
            }

            await transaction.commit();
            res.json({ success: true, processed });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        logger.error("Error processBatch:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 2. NEW WMS LOGIC (BULTOS & REMITOS)
// ==========================================

// --- BULTOS ---

exports.createBulto = async (req, res) => {
    const { codigoEtiqueta, tipo, ordenId, descripcion, ubicacion, usuarioId } = req.body;
    try {
        const pool = await getPool();
        // Insert or Update (upsert logic simple)
        const check = await pool.request().input('C', sql.VarChar, codigoEtiqueta).query("SELECT BultoID FROM Logistica_Bultos WHERE CodigoEtiqueta = @C");

        if (check.recordset.length > 0) {
            return res.json({ success: true, message: 'Bulto ya existía en sistema WMS', id: check.recordset[0].BultoID });
        }

        const r = await pool.request()
            .input('Cod', sql.VarChar, codigoEtiqueta)
            .input('Tip', sql.VarChar, tipo || 'PROD_TERMINADO')
            .input('OID', sql.Int, ordenId || null)
            .input('Desc', sql.NVarChar, descripcion || '')
            .input('Ubi', sql.NVarChar, ubicacion || 'PRODUCCION')
            .input('UID', sql.Int, usuarioId || 1)
            .query(`
                INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
                OUTPUT INSERTED.BultoID
                VALUES (@Cod, @Tip, @OID, @Desc, @Ubi, 'EN_STOCK', @UID)
            `);

        res.json({ success: true, id: r.recordset[0].BultoID });
    } catch (err) {
        logger.error("Error createBulto:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.resolveBultoQR = async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código faltante' });

    // 1. If it's already a giant string, just return it
    if (code.includes('$*')) {
        return res.json({ qrString: code });
    }

    try {
        const pool = await getPool();
        // Buscar el Bulto o código directo
        const bultoReq = await pool.request()
            .input('Cod', sql.VarChar, code)
            .query("SELECT OrdenID FROM Logistica_Bultos WHERE CodigoEtiqueta = @Cod");
            
        let ordenId = null;
        if (bultoReq.recordset.length > 0) {
            ordenId = bultoReq.recordset[0].OrdenID;
        } else {
            // Verificar si mandaron el CodigoOrden (ej. DF-90952)
            const ordReq = await pool.request()
                .input('Cod', sql.VarChar, code)
                .query("SELECT OrdenID FROM Ordenes WHERE CodigoOrden = @Cod");
            if (ordReq.recordset.length > 0) {
                ordenId = ordReq.recordset[0].OrdenID;
            } else {
                // Chequear OrdenesDeposito por las dudas
                const ordDepReq = await pool.request()
                    .input('Cod', sql.VarChar, code)
                    .query("SELECT OrdIdOrden as OrdenID FROM OrdenesDeposito WHERE OrdCodigoOrden = @Cod");
                if (ordDepReq.recordset.length > 0) {
                    ordenId = ordDepReq.recordset[0].OrdenID;
                }
            }
        }

        if (!ordenId) {
            return res.status(404).json({ error: 'No se pudo resolver el código a una orden.' });
        }

        // Recuperar el CodigoQR gigante de Etiquetas
        const qrReq = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query("SELECT TOP 1 CodigoQR FROM Etiquetas WHERE OrdenID = @OID AND CodigoQR IS NOT NULL");
            
        if (qrReq.recordset.length > 0 && qrReq.recordset[0].CodigoQR) {
            return res.json({ qrString: qrReq.recordset[0].CodigoQR, fromLabel: true, ordenId });
        }

        return res.status(404).json({ error: 'La orden no tiene un código QR crudo asignado (genere etiquetas).'});
    } catch (err) {
        logger.error("Error resolveBultoQR:", err);
        return res.status(500).json({ error: err.message });
    }
};

exports.getBultoByLabel = async (req, res) => {
    const { label } = req.params;
    try {
        const pool = await getPool();
        const r = await pool.request().input('L', sql.VarChar, label)
            .query("SELECT * FROM Logistica_Bultos WHERE CodigoEtiqueta = @L");

        if (r.recordset.length === 0) return res.status(404).json({ error: 'Bulto no encontrado' });
        res.json(r.recordset[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- REMITOS (DISPATCH) ---

exports.createRemito = async (req, res) => {
    // lineasOrden (Spec 39, opcional): [{ ordenId, completaOrden, cantidad, motivoPendiente }] — una por orden madre.
    const { areaOrigen, areaDestino, usuarioId, bultosIds = [], newBultos = [], observations, lineasOrden = [] } = req.body;

    // Generar codigo remito
    const codigoRemito = `REM-${Date.now().toString().slice(-6)}`;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const finalBultosIds = [...bultosIds];

            // 0. Procesar Bultos Nuevos (Auto-Creación)
            if (newBultos && newBultos.length > 0) {
                logger.info(`[createRemito] Creando ${newBultos.length} bultos automáticos...`);
                for (const nb of newBultos) {
                    // nb: { ordenId, descripcion }
                    // Generar código etiqueta automático si no viene
                    const autoLabel = `PAQ-${nb.ordenId}-${Math.floor(Math.random() * 1000)}`;

                    const rNew = await new sql.Request(transaction)
                        .input('Cod', sql.VarChar, autoLabel)
                        .input('Tip', sql.VarChar, nb.tipo || 'PROD_TERMINADO')
                        .input('OID', sql.Int, nb.ordenId)
                        .input('Desc', sql.NVarChar, nb.descripcion || 'Generado autom. en Despacho')
                        .input('Ubi', sql.NVarChar, areaOrigen || 'PRODUCCION')
                        .input('UID', sql.Int, usuarioId || 1)
                        .query(`
                            INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
                            OUTPUT INSERTED.BultoID
                            VALUES (@Cod, @Tip, @OID, @Desc, @Ubi, 'EN_STOCK', @UID)
                        `);

                    const newId = rNew.recordset[0].BultoID;
                    finalBultosIds.push(newId);
                }
            }

            if (finalBultosIds.length === 0) {
                throw new Error("No hay bultos para despachar (ni existentes ni nuevos).");
            }

            // --- GATE PEDIDO COMPLETO ---
            // Solo aplica a producto terminado: los insumos (TELA, PRENDA, etc.) que viajan
            // entre áreas para producir no se bloquean. Encomiendas tampoco (OrdenID apunta a OrdenesRetiro).
            // ENTREGAS PARCIALES: las áreas listadas en ConfiguracionGlobal.AREAS_DESPACHO_PARCIAL
            // pueden despachar un SUBCONJUNTO de bultos a OTRA área (no a DEPOSITO) sin exigir que el
            // pedido salga completo — para pedidos grandes que se mandan por tandas (ej. DIRECTA → Corte).
            // El resto de las áreas mantiene el candado de "pedido completo" intacto.
            let permiteParcial = false;
            if (areaOrigen && areaDestino !== 'DEPOSITO') {
                try {
                    const cfg = await new sql.Request(transaction)
                        .query("SELECT Valor FROM ConfiguracionGlobal WHERE Clave = 'AREAS_DESPACHO_PARCIAL'");
                    const areasParcial = (cfg.recordset[0]?.Valor || '')
                        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                    permiteParcial = areasParcial.includes(String(areaOrigen).trim().toUpperCase());
                } catch (e) {
                    logger.warn('[createRemito] No se pudo leer AREAS_DESPACHO_PARCIAL:', e.message);
                }
            }

            const idsGate = finalBultosIds.filter(id => !isNaN(id)).join(',');

            // --- ORDEN CANCELADA (25/09) ---
            // El bulto del producto de una orden cancelada no se despacha: no hay nada que entregar y
            // el remito queda esperándolo para siempre. Caso DTF-21591: cancelada el 08/09, su bulto
            // salió igual en REM-231455 y en REM-998757. La tela del cliente sí puede viajar (hay que
            // devolvérsela), por eso mira solo el producto.
            if (idsGate.length > 0) {
                const canceladas = await new sql.Request(transaction).query(`
                    SELECT DISTINCT b.CodigoEtiqueta, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden
                    FROM Logistica_Bultos b
                    JOIN Ordenes o ON o.OrdenID = b.OrdenID
                    WHERE b.BultoID IN (${idsGate})
                      AND b.Tipocontenido IN ('PROD_TERMINADO', 'EN_PROCESO')
                      AND (b.Estado = 'CANCELADO' OR UPPER(LTRIM(RTRIM(ISNULL(o.Estado, '')))) = 'CANCELADO')
                `);
                if (canceladas.recordset.length > 0) {
                    const det = canceladas.recordset.map(c => `${c.CodigoEtiqueta} (${c.CodigoOrden})`).join(', ');
                    const err = new Error(`Bulto cancelado o de una orden cancelada, no se despacha: ${det}. Sacalo del despacho y apartalo.`);
                    err.statusCode = 400;
                    throw err;
                }
            }

            if (idsGate.length > 0) {
                const ordenesGate = await new sql.Request(transaction).query(`
                    SELECT DISTINCT o.OrdenID, o.CodigoOrden, o.NoDocERP, o.AreaID
                    FROM Logistica_Bultos b
                    JOIN Ordenes o ON b.OrdenID = o.OrdenID
                    WHERE b.BultoID IN (${idsGate})
                      AND b.Tipocontenido = 'PROD_TERMINADO'
                `);

                if (!permiteParcial) {
                    await validarPedidosCompletos(transaction, ordenesGate.recordset, areaDestino);

                    // --- CANDADO: el pedido debe salir COMPLETO del área ---
                    // No deja despachar si quedan bultos del mismo pedido (misma área, producto terminado,
                    // en stock, sin remito) por fuera de este despacho. Garantiza que el pedido no se parta.
                    const nodocs = [...new Set(ordenesGate.recordset.map(o => o.NoDocERP).filter(Boolean).map(n => String(n).trim()))];
                    if (nodocs.length > 0 && areaOrigen) {
                        const nodocList = nodocs.map(n => `'${n.replace(/'/g, "''")}'`).join(',');
                        const faltan = await new sql.Request(transaction)
                            .input('AreaOrig', sql.VarChar, areaOrigen)
                            .query(`
                                SELECT DISTINCT o.CodigoOrden
                                FROM Logistica_Bultos b
                                JOIN Ordenes o ON b.OrdenID = o.OrdenID
                                WHERE LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) IN (${nodocList})
                                  AND b.UbicacionActual = @AreaOrig
                                  AND b.Estado = 'EN_STOCK'
                                  AND b.Tipocontenido = 'PROD_TERMINADO'
                                  AND b.BultoID NOT IN (${idsGate})
                                  -- Fallas internas (-F): NUNCA obligan a "salir completo" — son órdenes
                                  -- efímeras que reponen material de la madre, no un ítem del pedido del cliente.
                                  AND (o.CodigoOrden IS NULL OR o.CodigoOrden NOT LIKE '%-F%')
                                  AND NOT EXISTS (SELECT 1 FROM Logistica_EnvioItems ei WHERE ei.BultoID = b.BultoID)
                            `);
                        if (faltan.recordset.length > 0) {
                            const det = [...new Set(faltan.recordset.map(f => f.CodigoOrden))].join(', ');
                            const err = new Error(`El pedido debe salir completo del área. Faltan por agregar al remito: ${det}.`);
                            err.statusCode = 400;
                            throw err;
                        }
                    }
                }
            }

            // --- AVISO: EL PEDIDO SALE PARTIDO DEL ÁREA (01/10) ---
            // Las entregas parciales entre áreas están permitidas, pero el operario tiene que SABER qué
            // deja atrás: caso SUB-26025 (1/2) y (2/2), dos telas del mismo pedido, las dos prontas, y el
            // remito dejó sacar una sola sin decir nada. Si del mismo pedido quedan órdenes de ESTA área
            // fuera del despacho (prontas con bulto, o todavía en producción), se frena con 409
            // PEDIDO_PARCIAL; el front muestra el detalle y, si confirman, reintenta con
            // confirmarPedidoParcial = true. Solo en pedidos hechos por una persona (req.headers): los
            // remitos automáticos (retiros WMS, consolidación en PRO) no preguntan. A DEPOSITO no aplica:
            // ahí ya manda el candado de pedido completo.
            if (idsGate.length > 0 && areaOrigen && areaDestino !== 'DEPOSITO' && req.headers && !req.body?.confirmarPedidoParcial) {
                const quedan = await new sql.Request(transaction)
                    .input('AreaOrig', sql.VarChar, String(areaOrigen).trim())
                    .query(`
                        SELECT LTRIM(RTRIM(h.CodigoOrden)) AS CodigoOrden, LTRIM(RTRIM(h.Material)) AS Material,
                               LTRIM(RTRIM(ISNULL(h.Estado, ''))) AS Estado, LTRIM(RTRIM(ISNULL(h.EstadoenArea, ''))) AS EstadoenArea,
                               LTRIM(RTRIM(CAST(h.NoDocERP AS VARCHAR(50)))) AS NoDoc,
                               (SELECT COUNT(*) FROM Logistica_Bultos b2
                                 WHERE b2.OrdenID = h.OrdenID AND b2.UbicacionActual = @AreaOrig AND b2.Estado = 'EN_STOCK'
                                   AND ISNULL(b2.Tipocontenido, '') <> 'ENCOMIENDA'
                                   AND NOT EXISTS (SELECT 1 FROM Logistica_EnvioItems ei WHERE ei.BultoID = b2.BultoID)) AS BultosListos
                        FROM Ordenes h
                        WHERE UPPER(LTRIM(RTRIM(h.AreaID))) = UPPER(@AreaOrig)
                          AND LTRIM(RTRIM(CAST(h.NoDocERP AS VARCHAR(50)))) IN (
                                SELECT DISTINCT LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50))))
                                FROM Logistica_Bultos b JOIN Ordenes o ON o.OrdenID = b.OrdenID
                                WHERE b.BultoID IN (${idsGate}) AND ISNULL(b.Tipocontenido, '') <> 'ENCOMIENDA'
                                  AND o.NoDocERP IS NOT NULL AND LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) <> ''
                                  AND UPPER(LTRIM(RTRIM(o.AreaID))) = UPPER(@AreaOrig))
                          AND h.OrdenID NOT IN (SELECT b.OrdenID FROM Logistica_Bultos b WHERE b.BultoID IN (${idsGate}) AND b.OrdenID IS NOT NULL)
                          AND UPPER(LTRIM(RTRIM(ISNULL(h.Estado, '')))) NOT IN ('CANCELADO', 'FINALIZADO', 'ENTREGADO')
                          AND LTRIM(RTRIM(ISNULL(h.EstadoenArea, ''))) NOT IN ('En transito', 'En Transito', 'En Tránsito', 'Recibido en Destino', 'Entregado', 'Ingresado')
                          AND ISNULL(h.EstadoDependencia, '') <> 'VENTA_DIRECTA'
                          AND (h.CodigoOrden IS NULL OR h.CodigoOrden NOT LIKE '%-F%')
                          -- Orden PRONTA sin bulto propio: su trabajo viaja en el bulto de la hermana que sí está en
                          -- este remito (dos Estampados sobre la misma prenda, DTF y TPU, salen en UN solo bulto:
                          -- EST-26025 (1/2) lleva el bulto y la (2/2) no tiene). No queda nada atrás: no se avisa.
                          AND NOT (LTRIM(RTRIM(ISNULL(h.EstadoenArea, ''))) = 'Pronto'
                                   AND NOT EXISTS (SELECT 1 FROM Logistica_Bultos bx
                                                   WHERE bx.OrdenID = h.OrdenID AND ISNULL(bx.Estado, '') <> 'CANCELADO'))
                        ORDER BY h.OrdenID`);
                if (quedan.recordset.length > 0) {
                    const det = quedan.recordset.map(x => {
                        const donde = Number(x.BultosListos) > 0
                            ? `PRONTA, con ${x.BultosListos} bulto${Number(x.BultosListos) === 1 ? '' : 's'} listo${Number(x.BultosListos) === 1 ? '' : 's'} para sumar a este remito`
                            : `todavía en producción (${x.EstadoenArea || x.Estado || 'sin estado'})`;
                        return `${x.CodigoOrden}${x.Material ? ' · ' + x.Material : ''} — ${donde}`;
                    }).join('\n');
                    const docs = [...new Set(quedan.recordset.map(x => x.NoDoc))].join(', ');
                    const err = new Error(`Del pedido ${docs} quedan en ${String(areaOrigen).trim()} fuera de este remito:\n${det}\n\nSi lo enviás así, el pedido sale del área en partes.`);
                    err.statusCode = 409;
                    err.codigo = 'PEDIDO_PARCIAL';
                    err.ordenes = quedan.recordset;
                    throw err;
                }
            }

            // --- AVISO: ORDEN YA ENTREGADA AL CLIENTE (25/09) ---
            // Caso REM-396361: Terminaciones despachó a Depósito el bulto de una orden que el cliente
            // se había llevado el día anterior, y el remito quedó abierto para siempre. Si el retiro de
            // alguna orden del despacho ya está Entregado (OrdenesRetiro 5 — el 9 de OrdenesDeposito NO
            // alcanza: crearRetiro también lo pone al armar el retiro), se frena con 409; el front
            // pregunta y, si el operario confirma, reintenta con confirmarEntregadas = true.
            // Mira solo el retiro de la PROPIA orden. Una reposición o falla que se despacha después de
            // entregada su madre es mercadería nueva que va al cliente (caso REM-916042: EUV-22429-R1,
            // despachada el 22/09 con la madre entregada el 15/09): avisar ahí sería una falsa alarma.
            if (idsGate.length > 0 && !req.body?.confirmarEntregadas) {
                const yaEntregadas = await new sql.Request(transaction).query(`
                    SELECT DISTINCT o.CodigoOrden, CONVERT(varchar(10), r.OReFechaEstadoActual, 103) AS Fecha
                    FROM Logistica_Bultos b
                    JOIN Ordenes o ON o.OrdenID = b.OrdenID
                    JOIN OrdenesDeposito od ON od.OrdCodigoOrden IN (o.CodigoOrden, o.NoDocERP)
                    JOIN OrdenesRetiro r ON r.OReIdOrdenRetiro = od.OReIdOrdenRetiro AND r.OReEstadoActual = 5
                    WHERE b.BultoID IN (${idsGate}) AND ISNULL(b.Tipocontenido, '') <> 'ENCOMIENDA'
                `);
                if (yaEntregadas.recordset.length > 0) {
                    const det = yaEntregadas.recordset.map(x => `${x.CodigoOrden} (el ${x.Fecha})`).join(', ');
                    const err = new Error(`Ya se entregó al cliente: ${det}. Si lo despachás igual, el remito va a quedar abierto sin nada que recibir.`);
                    err.statusCode = 409;
                    err.codigo = 'ORDENES_ENTREGADAS';
                    err.ordenes = yaEntregadas.recordset;
                    throw err;
                }
            }

            // --- AUTO-CONSUME: Consumir Insumos Transformados ---
            // Regla: Al despachar un tipo de producto (ej: PROD_TERMINADO), consumimos los insumos (ej: TELA/PRENDA) de esa orden en el área.
            if (finalBultosIds.length > 0) {
                const safeIds = finalBultosIds.filter(id => !isNaN(id)).join(',');

                if (safeIds.length > 0) {
                    // Detectar qué Tipos de contenido estamos despachando por Orden
                    const typesRes = await new sql.Request(transaction).query(`
                        SELECT DISTINCT OrdenID, Tipocontenido 
                        FROM Logistica_Bultos 
                        WHERE BultoID IN (${safeIds}) 
                        AND OrdenID IS NOT NULL
                     `);

                    for (const g of typesRes.recordset) {
                        // Para esta orden, damos de baja (PROCESADO) todo lo que sea de TIPO DIFERENTE
                        const consumedRes = await new sql.Request(transaction)
                            .input('OID', sql.Int, g.OrdenID)
                            .input('Tip', sql.VarChar, g.Tipocontenido) // El tipo que SALE
                            .input('Orig', sql.VarChar, areaOrigen)
                            .input('User', sql.Int, usuarioId || 1)
                            .query(`
                                UPDATE Logistica_Bultos 
                                SET Estado = 'PROCESADO', UbicacionActual = 'PROCESADO'
                                OUTPUT INSERTED.CodigoEtiqueta, INSERTED.BultoID
                                WHERE OrdenID = @OID 
                                AND UbicacionActual = @Orig 
                                AND Estado = 'EN_STOCK'
                                AND Tipocontenido <> @Tip -- Diferente tipo (Insumo)
                            `);

                        // Log Movements
                        for (const c of consumedRes.recordset) {
                            await registrarMovimiento(transaction, {
                                codigoBulto: c.CodigoEtiqueta,
                                tipo: 'CONSUMO',
                                area: areaOrigen,
                                usuario: usuarioId,
                                obs: `Consumo auto por salida de ${g.Tipocontenido}`,
                                estAnt: 'EN_STOCK',
                                estNew: 'PROCESADO',
                                esRecep: false
                            });
                        }
                    }
                    logger.info("[createRemito] Auto-consumed inputs for dispatched orders.");
                }
            }

            // 1. Crear Cabecera
            const headRes = await new sql.Request(transaction)
                .input('Code', sql.VarChar, codigoRemito)
                .input('Orig', sql.VarChar, areaOrigen)
                .input('Dest', sql.VarChar, areaDestino)
                .input('User', sql.Int, usuarioId)
                .input('Obs', sql.NVarChar, observations)
                .query(`
                    INSERT INTO Logistica_Envios 
                    (CodigoRemito, AreaOrigenID, AreaDestinoID, UsuarioEmisor, FechaSalida, Estado, Observaciones)
                    OUTPUT INSERTED.EnvioID
                    VALUES (@Code, @Orig, @Dest, @User, GETDATE(), 'ESPERANDO_RETIRO', @Obs)
                `);
            const envioId = headRes.recordset[0].EnvioID;

            // 2. Insertar Items y Actualizar Bultos
            const dispatchedOrders = new Set();
            const bultosPorOrden = new Map(); // OrdenID -> cantidad de bultos en este remito (para el libro)
            for (const bid of finalBultosIds) {
                // Link
                await new sql.Request(transaction)
                    .input('EID', sql.Int, envioId)
                    .input('BID', sql.Int, bid)
                    .query(`INSERT INTO Logistica_EnvioItems (EnvioID, BultoID, EstadoRecepcion) VALUES (@EID, @BID, 'PENDIENTE')`);

                // Update Bulto Status and Log Movement
                const upRes = await new sql.Request(transaction)
                    .input('BID', sql.Int, bid)
                    .query(`
                        UPDATE Logistica_Bultos 
                        SET Estado = 'EN_TRANSITO', UbicacionActual = 'TRANSITO' 
                        OUTPUT INSERTED.CodigoEtiqueta, INSERTED.Estado, INSERTED.Tipocontenido, INSERTED.OrdenID
                        WHERE BultoID = @BID
                    `);

                if (upRes.recordset.length > 0) {
                    const row = upRes.recordset[0];
                    await registrarMovimiento(transaction, {
                        codigoBulto: row.CodigoEtiqueta,
                        tipo: 'SALIDA',
                        area: areaOrigen,
                        usuario: usuarioId,
                        obs: `Despacho Remito ${codigoRemito}`,
                        estAnt: 'EN_STOCK',
                        estNew: 'EN_TRANSITO',
                        esRecep: false
                    });
                    
                    // IF it's an encomienda, mark the Order as Dispatched (State 10) to block it from being selected again
                    if (row.Tipocontenido === 'ENCOMIENDA' && row.OrdenID) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, row.OrdenID)
                            .query(`
                                UPDATE OrdenesRetiro 
                                SET OReEstadoActual = 10, OReFechaEstadoActual = GETDATE() 
                                WHERE OReIdOrdenRetiro = @OID
                            `);
                    } else if (row.Tipocontenido !== 'ENCOMIENDA' && row.OrdenID) {
                        dispatchedOrders.add(row.OrdenID);
                        // Producto de la orden que viaja al área siguiente: terminado (va a Depósito) o en proceso
                        // (va a otra área productiva). Los insumos (TELA/PRENDA) no llevan línea en el libro.
                        if (row.Tipocontenido === 'PROD_TERMINADO' || row.Tipocontenido === 'EN_PROCESO') bultosPorOrden.set(row.OrdenID, (bultosPorOrden.get(row.OrdenID) || 0) + 1);
                    }
                }
            }

            // --- LÍNEAS POR ORDEN (Spec 39): libro de entregas ---
            // Una línea por orden madre: motivo del pendiente, cantidad opcional (obligatoria donde se
            // cuentan prendas/unidades) y la marca "completa la orden". Un bulto de una orden de falla
            // con registro en Reposiciones viaja como COMPLEMENTO de su madre. Sin líneas declaradas
            // (áreas sin parcial habilitado) la orden sale completa, como hoy.
            const { lineasFinales, ordenesSinCompletar } = await armarLineasRemito(transaction, {
                dispatchedOrders, bultosPorOrden, lineasOrden, permiteParcial, areaOrigen, areaDestino,
            });
            if (lineasFinales.length > 0) await libroEntregas.registrarLineasEnvio(transaction, envioId, lineasFinales, usuarioId);

            for (const oid of dispatchedOrders) {
                // Envío PARCIAL (Spec 39, RN-FLT.03): la orden pasa a "En transito" recién con el envío
                // marcado "completa la orden". Mientras tanto queda en su área con envío Parcial.
                if (ordenesSinCompletar.has(Number(oid))) continue;

                await changeOrderState(transaction, {
                    target   : { type: 'ORDER', id: oid },
                    estado   : 'En transito',
                    userObj  : req.user || req.body.usuario || usuarioId || 'Sistema',
                    detalle  : `Asignado a remito y numero del remito ${codigoRemito}`,
                    // Despachar algo de una orden cancelada (la tela del cliente, que sí viaja) no la
                    // saca de Cancelado: DTF-21591 volvió así dos veces a "En transito" (08/09 y 23/09).
                    guard    : "UPPER(LTRIM(RTRIM(ISNULL(Estado, '')))) <> 'CANCELADO'",
                    io       : req.app.get('socketio')
                });

                // [BULTO COMPARTIDO 01/10] La hermana SIN bulto propio (segundo Estampado de la misma prenda)
                // viaja en este bulto: pasa a "En transito" junto con la que lo lleva. A Depósito no aplica
                // (ahí el ingreso se procesa por pedido completo).
                if (areaDestino !== 'DEPOSITO') {
                    const viajan = await hermanasSinBultoPropio(transaction, oid, ['Pronto'], 'En transito');
                    for (const hv of viajan) {
                        await changeOrderState(transaction, {
                            target : { type: 'ORDER', id: hv.OrdenID },
                            estado : 'En transito',
                            userObj: req.user || req.body.usuario || usuarioId || 'Sistema',
                            detalle: `Viaja en el bulto de ${hv.CodigoPortadora} (remito ${codigoRemito})`,
                            guard  : "EstadoenArea = 'Pronto'",
                            io     : req.app.get('socketio')
                        });
                    }
                }
            }

            await transaction.commit();
            res.json({ success: true, dispatchCode: codigoRemito, envioId, createdCount: newBultos.length });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        // Pedido incompleto / candado de Depósito (statusCode 400): la regla funcionando, no una falla.
        if (err.statusCode && err.statusCode < 500) logger.warn(`Rechazado createRemito: ${err.message}`);
        else logger.error("Error createRemito:", err);
        res.status(err.statusCode || 500).json({ error: err.message, ...(err.codigo ? { codigo: err.codigo, ordenes: err.ordenes } : {}) });
    }
};

exports.createRemitoFromOrders = async (req, res) => {
    const { areaOrigen, areaDestino, usuarioId, orderIds = [], observations, confirmarEntregadas, confirmarPedidoParcial } = req.body;
    
    if (!orderIds || orderIds.length === 0) {
        return res.status(400).json({ error: "No orders provided" });
    }

    try {
        const pool = await getPool();
        
        // 1. Fetch existing bultos for these orders that are in the areaOrigen AND not dispatched
        const bultosRes = await pool.request()
            .input('Orig', sql.VarChar, areaOrigen)
            .query(`
                SELECT BultoID, OrdenID 
                FROM Logistica_Bultos 
                WHERE OrdenID IN (${orderIds.join(',')}) 
                AND UbicacionActual = @Orig 
                AND Estado = 'EN_STOCK'
            `);
            
        const existingBultos = bultosRes.recordset;
        const bultosIds = existingBultos.map(b => b.BultoID);
        const ordersWithBultos = new Set(existingBultos.map(b => b.OrdenID));
        
        // 2. Identify orders that DO NOT have bultos yet
        const newBultos = [];
        for (const oid of orderIds) {
            if (!ordersWithBultos.has(oid)) {
                // Fetch basic order info to create the bulto
                const ordReq = await pool.request().input('OID', sql.Int, oid).query("SELECT Cliente, CodigoOrden FROM Ordenes WHERE OrdenID = @OID");
                let desc = "Auto-generado";
                if(ordReq.recordset.length > 0) desc = `${ordReq.recordset[0].CodigoOrden} - ${ordReq.recordset[0].Cliente}`;
                
                newBultos.push({
                    ordenId: oid,
                    descripcion: desc,
                    tipo: 'PROD_TERMINADO'
                });
            }
        }
        
        // 3. Delegate to existing logic by overriding req.body
        req.body = {
            areaOrigen,
            areaDestino,
            usuarioId,
            bultosIds,
            newBultos,
            observations,
            confirmarEntregadas,   // [25/09] el aviso de orden ya entregada también pasa por acá
            confirmarPedidoParcial // [01/10] y el de "el pedido sale partido del área"
        };
        
        return exports.createRemito(req, res);
        
    } catch (err) {
        logger.error("Error createRemitoFromOrders:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.validateDispatch = async (req, res) => {
    const { bultosIds } = req.body; // Array of IDs
    // Check status
    try {
        const pool = await getPool();
        // Si la lista esta vacia es valido (quizas son todos nuevos)
        if (!bultosIds || bultosIds.length === 0) return res.json({ valid: true, details: [] });

        // Podriamos chequear si estan disponibles
        const r = await pool.request().query(`SELECT BultoID, Estado, UbicacionActual FROM Logistica_Bultos WHERE BultoID IN (${bultosIds.join(',')})`);
        res.json({ valid: true, details: r.recordset });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getRemitoByCode = async (req, res) => {
    const { code } = req.params;
    try {
        const pool = await getPool();
        // Cabecera
        const head = await pool.request().input('C', sql.VarChar, code)
            .query("SELECT * FROM Logistica_Envios WHERE CodigoRemito = @C");

        if (head.recordset.length === 0) return res.status(404).json({ error: 'Remito no encontrado' });
        const envio = head.recordset[0];

        // Items + Bulto Info + Orden Info
        const items = await pool.request().input('EID', sql.Int, envio.EnvioID)
            .query(`
                SELECT i.*, b.Estado as BultoEstado, b.CodigoEtiqueta, b.Descripcion, b.OrdenID, b.ComprobantePath,
                       b.Tipocontenido, o.Cliente, o.DescripcionTrabajo, o.CodigoOrden, o.NoDocERP,
                       cliord.IDCliente AS IDCliente,
                       et.NumeroBulto, et.TotalBultos,
                       CASE
                           WHEN b.Tipocontenido = 'ENCOMIENDA' AND ret.OReIdOrdenRetiro IS NOT NULL
                           THEN ISNULL(ret.FormaRetiro, 'R') + '-' + CAST(ret.OReIdOrdenRetiro AS VARCHAR)
                           ELSE NULL
                       END AS RetiroAsociado,
                       ret.OReIdOrdenRetiro AS RetiroID,
                       ret.ReceptorNombre,
                       cli.Nombre AS ClienteRetiro
                FROM Logistica_EnvioItems i
                INNER JOIN Logistica_Bultos b ON i.BultoID = b.BultoID
                -- OJO: en bultos de ENCOMIENDA el OrdenID es el N° de OrdenesRetiro, NO de
                -- Ordenes — sin el filtro, una encomienda vieja se cuelga de la orden NUEVA
                -- que nació con ese mismo OrdenID (caso XEUV-12142 vs PAQ-12662-535).
                LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
                LEFT JOIN dbo.Clientes cliord WITH(NOLOCK) ON o.CliIdCliente = cliord.CliIdCliente
                LEFT JOIN OrdenesRetiro ret ON b.OrdenID = ret.OReIdOrdenRetiro
                LEFT JOIN Clientes cli ON ret.CodCliente = cli.CodCliente
                OUTER APPLY (
                    SELECT TOP 1 E.NumeroBulto, E.TotalBultos
                    FROM Etiquetas E WITH(NOLOCK)
                    WHERE E.CodigoEtiqueta = b.CodigoEtiqueta
                ) et
                WHERE i.EnvioID = @EID
            `);

        // Spec 39: líneas por orden del remito (envío parcial / complemento / completa la orden)
        let lineasOrden = [];
        try {
            const lin = await pool.request().input('EID', sql.Int, envio.EnvioID).query(`
                SELECT eo.*, o.CodigoOrden, o.AreaID, o.NoDocERP, f.CodigoOrden AS CodigoOrigen, r.AreaProduce, r.AreaReporta, r.Estado AS EstadoReposicion
                FROM Logistica_EnvioOrdenes eo
                JOIN Ordenes o ON o.OrdenID = eo.OrdenID
                LEFT JOIN Ordenes f ON f.OrdenID = eo.OrdenOrigenID
                LEFT JOIN Reposiciones r ON r.ReposicionID = eo.ReposicionID
                WHERE eo.EnvioID = @EID ORDER BY eo.EnvioOrdenID`);
            lineasOrden = lin.recordset;
        } catch (eLin) { logger.warn('[getRemitoByCode] líneas por orden:', eLin.message); }

        res.json({ ...envio, items: items.recordset, lineasOrden });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.searchRemitos = async (req, res) => {
    const { query } = req.query;
    console.log('[SEARCH REMITOS] query recibida:', query);
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Q',      sql.VarChar, `%${query}%`)
            .input('QExact', sql.VarChar, query)
            .query(`
                SELECT DISTINCT TOP 20
                    e.EnvioID,
                    e.CodigoRemito,
                    e.Estado,
                    e.FechaSalida,
                    e.AreaOrigenID,
                    e.AreaDestinoID,
                    (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) AS TotalItems,
                    -- Código de la orden que coincidió con la búsqueda
                    COALESCE(od.OrdCodigoOrden, o.CodigoOrden, CAST(b.OrdenID AS VARCHAR)) AS OrdenEncontrada
                FROM Logistica_Envios e
                INNER JOIN Logistica_EnvioItems i  ON e.EnvioID  = i.EnvioID
                INNER JOIN Logistica_Bultos     b  ON i.BultoID  = b.BultoID
                -- Encomiendas: su OrdenID es el N° de OrdenesRetiro, no de Ordenes — sin el
                -- filtro, buscar una orden nueva encontraba remitos viejos de encomiendas ajenas.
                LEFT  JOIN Ordenes              o  ON o.OrdenID  = b.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
                LEFT  JOIN OrdenesDeposito      od ON od.OrdIdOrden = b.OrdenID
                WHERE b.CodigoEtiqueta   LIKE @Q
                   OR CAST(b.OrdenID AS VARCHAR) = @QExact
                   OR e.CodigoRemito              = @QExact
                   OR o.CodigoOrden               LIKE @Q
                   OR CAST(o.NoDocERP AS VARCHAR)  LIKE @Q
                   OR od.OrdCodigoOrden            LIKE @Q
                ORDER BY e.FechaSalida DESC
            `);
        console.log('[SEARCH REMITOS] resultados:', r.recordset.length);
        res.json(r.recordset);
    } catch (err) {
        console.error('[SEARCH REMITOS] ERROR:', err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.getIncomingRemitos = async (req, res) => {
    const { areaId } = req.query;
    if (!areaId) return res.json([]);
    const isTodos = areaId === 'TODOS';

    try {
        const pool = await getPool();
        const q = isTodos ? `
            SELECT e.*, 
                   (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalItems
            FROM Logistica_Envios e
            WHERE e.Estado IN ('ESPERANDO_RETIRO', 'EN_TRANSITO', 'EN_TRANSITO_PARCIAL', 'DESPACHADO', 'RECIBIDO_PARCIAL')
            ORDER BY e.FechaSalida DESC
        ` : `
            SELECT e.*, 
                   (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalItems
            FROM Logistica_Envios e
            WHERE e.AreaDestinoID = @A
            AND e.Estado IN ('ESPERANDO_RETIRO', 'EN_TRANSITO', 'EN_TRANSITO_PARCIAL', 'DESPACHADO', 'RECIBIDO_PARCIAL')
            ORDER BY e.FechaSalida DESC
        `;
        
        const r = await pool.request().input('A', sql.VarChar, areaId).query(q);
        res.json(r.recordset);
    } catch (err) {
        logger.error("Error getIncomingRemitos:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getOutgoingRemitos = async (req, res) => {
    const { areaId } = req.query;
    if (!areaId) return res.json([]);
    const isTodos = areaId === 'TODOS';

    try {
        const pool = await getPool();
        const q = isTodos ? `
            SELECT e.*, 
                   (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalItems
            FROM Logistica_Envios e
            ORDER BY e.FechaSalida DESC
        ` : `
            SELECT e.*, 
                   (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalItems
            FROM Logistica_Envios e
            WHERE e.AreaOrigenID = @A
            ORDER BY e.FechaSalida DESC
        `;
        
        const r = await pool.request().input('A', sql.VarChar, areaId).query(q);
        res.json(r.recordset);
    } catch (err) {
        logger.error("Error getOutgoingRemitos:", err);
        res.status(500).json({ error: err.message });
    }
};

// --- RECEPCION DE DESPACHOS ---

// [ACCESORIOS] Un producto fabricado puede llevar accesorios de stock (mástil, base…) que salen con él.
// Cada accesorio es una venta de retiro VEN- (Ordenes AreaID PRO / VENTA_DIRECTA, DescripcionTrabajo
// "RETIRO ACCESORIO — …", ComboPedidoNoDocERP = pedido) que Producción recibe al confirmarse en
// Logística WMS. A Depósito no entra nada del pedido mientras falte recibir alguno, o la cantidad
// retirada sea menor a la que el pedido necesita (unidades × cantidad por unidad, guardada en Magnitud).
// Lanza Error (statusCode 400) con el detalle.
async function validarAccesoriosRecibidos(transaction, ordenes) {
    const docs = [...new Set((ordenes || []).map(o => String(o.NoDocERP || '').trim()).filter(Boolean))];
    if (!docs.length) return;
    const lista = docs.map(d => `'${d.replace(/'/g, "''")}'`).join(',');
    const r = await new sql.Request(transaction).query(`
        SELECT LTRIM(RTRIM(a.ComboPedidoNoDocERP)) AS Doc, LTRIM(RTRIM(a.NoDocERP)) AS Ven,
               a.DescripcionTrabajo, TRY_CAST(a.Magnitud AS DECIMAL(18,2)) AS Necesita,
               pc.EstadoCobro,
               ISNULL((SELECT SUM(d.Cantidad) FROM PedidosCobranzaDetalle d WHERE d.PedidoCobranzaID = pc.ID), 0) AS Retirada,
               (SELECT COUNT(*) FROM Logistica_Bultos b WHERE b.OrdenID = a.OrdenID AND b.Estado = 'EN_STOCK' AND b.UbicacionActual = 'PRO') AS BultosEnPro
        FROM Ordenes a
        LEFT JOIN PedidosCobranza pc ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(a.NoDocERP))
        WHERE a.AreaID = 'PRO' AND a.EstadoDependencia = 'VENTA_DIRECTA'
          AND a.DescripcionTrabajo LIKE 'RETIRO ACCESORIO%'
          AND LTRIM(RTRIM(a.ComboPedidoNoDocERP)) IN (${lista})`);
    const faltan = r.recordset.filter(x => {
        const est = String(x.EstadoCobro || '').toUpperCase();
        // Recibido = el bulto del accesorio está EN_STOCK en PRO (Producción recibió el remito).
        // Retirado pero en camino (remito sin recibir) también cuenta como faltante.
        const sinRecibir = est === 'CANCELADO' || Number(x.BultosEnPro) === 0;
        const cantidadCorta = x.Necesita != null && Number(x.Retirada) < Number(x.Necesita);
        return sinRecibir || cantidadCorta;
    });
    if (!faltan.length) return;
    const detalle = faltan.map(x => {
        const nombre = String(x.DescripcionTrabajo || '').replace(/^RETIRO ACCESORIO\s*[—-]\s*/i, '');
        const est = String(x.EstadoCobro || '').toUpperCase();
        const motivo = (!est || est === 'PENDIENTE' || est === 'EN_PREPARACION') ? 'retiro sin confirmar en Logística WMS'
            : est === 'CANCELADO' ? 'venta cancelada'
                : Number(x.BultosEnPro) === 0 ? 'retirado pero el remito a Producción no se recibió'
                    : `retirados ${Number(x.Retirada)} de ${Number(x.Necesita)}`;
        return `${nombre} ×${x.Necesita != null ? Number(x.Necesita) : '?'} (${x.Ven}: ${motivo})`;
    }).join('; ');
    const err = new Error(`El pedido ${faltan[0].Doc} no puede entrar a Depósito: faltan los accesorios de stock que salen con el producto — ${detalle}. Producción tiene que recibir el retiro de cada accesorio (Logística WMS) antes de mandar el pedido a Depósito.`);
    err.statusCode = 400;
    throw err;
}

exports.receiveDispatch = async (req, res) => {
    let { envioId, itemsRecibidos, usuarioId, areaReceptora, codigoEtiqueta, forzarOrdenes } = req.body;
    // itemsRecibidos: [{ bultoId, estado: 'ESCANEADO' | 'FALTANTE' }]

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // AUTO-DETECT AREA & SINGLE MODE SUPPORT
            if (!areaReceptora) {
                // Fetch from Remito Destino
                const remitoCheck = await new sql.Request(transaction)
                    .input('EID', sql.Int, envioId)
                    .query("SELECT AreaDestinoID FROM Logistica_Envios WHERE EnvioID = @EID");
                if (remitoCheck.recordset.length > 0) {
                    areaReceptora = remitoCheck.recordset[0].AreaDestinoID;
                }
            }

            // SINGLE ITEM MODE (Scanner)
            if (codigoEtiqueta && !itemsRecibidos) {
                // Resolve BultoID
                const bultoReq = await new sql.Request(transaction)
                    .input('C', sql.VarChar, codigoEtiqueta)
                    .query("SELECT BultoID FROM Logistica_Bultos WHERE CodigoEtiqueta = @C");

                if (bultoReq.recordset.length === 0) throw new Error("Bulto no encontrado: " + codigoEtiqueta);

                const bId = bultoReq.recordset[0].BultoID;
                itemsRecibidos = [{ bultoId: bId, estado: 'ESCANEADO' }];
            }

            // FORZAR-PURO (desde la bandeja "Esperando Bultos"): puede llegar sin bultos nuevos,
            // solo con forzarOrdenes. En ese caso no hay remito (envioId) ni items.
            if (!itemsRecibidos) itemsRecibidos = [];
            if (!areaReceptora && Array.isArray(forzarOrdenes) && forzarOrdenes.length > 0) areaReceptora = 'DEPOSITO';

            // --- ORDEN CANCELADA (25/09) ---
            // Un bulto cancelado, o del producto de una orden cancelada, no se recibe: recibirlo lo
            // devolvía al stock y en Depósito pasaba la orden cancelada a Finalizado. Se aparta; si la
            // orden se reactiva, sus bultos vuelven solos (bultosCancelacionService).
            const idsARecibir = itemsRecibidos.filter(i => i.estado === 'ESCANEADO' && !isNaN(i.bultoId)).map(i => Number(i.bultoId));
            if (idsARecibir.length > 0) {
                const canceladas = await new sql.Request(transaction).query(`
                    SELECT DISTINCT b.CodigoEtiqueta, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden
                    FROM Logistica_Bultos b
                    LEFT JOIN Ordenes o ON o.OrdenID = b.OrdenID AND ISNULL(b.Tipocontenido, '') <> 'ENCOMIENDA'
                    WHERE b.BultoID IN (${idsARecibir.join(',')})
                      AND (b.Estado = 'CANCELADO'
                           OR (b.Tipocontenido IN ('PROD_TERMINADO', 'EN_PROCESO')
                               AND UPPER(LTRIM(RTRIM(ISNULL(o.Estado, '')))) = 'CANCELADO'))
                `);
                if (canceladas.recordset.length > 0) {
                    const det = canceladas.recordset.map(c => c.CodigoOrden ? `${c.CodigoEtiqueta} (${c.CodigoOrden})` : c.CodigoEtiqueta).join(', ');
                    const err = new Error(`Bulto cancelado o de una orden cancelada, no se recibe: ${det}. Apartalo; si la orden se reactiva, el bulto vuelve solo al stock.`);
                    err.statusCode = 400;
                    throw err;
                }
            }

            // --- GATE PEDIDO COMPLETO: a DEPOSITO solo se recibe con el pedido completo (todas las áreas) ---
            if (areaReceptora === 'DEPOSITO') {
                const idsEscaneados = (itemsRecibidos || [])
                    .filter(i => i.estado === 'ESCANEADO' && !isNaN(i.bultoId))
                    .map(i => i.bultoId);
                if (idsEscaneados.length > 0) {
                    const ordenesGate = await new sql.Request(transaction).query(`
                        SELECT DISTINCT o.OrdenID, o.CodigoOrden, o.NoDocERP, o.AreaID
                        FROM Logistica_Bultos b
                        JOIN Ordenes o ON b.OrdenID = o.OrdenID
                        WHERE b.BultoID IN (${idsEscaneados.join(',')})
                          AND b.Tipocontenido = 'PROD_TERMINADO'
                    `);
                    await validarPedidosCompletos(transaction, ordenesGate.recordset, 'DEPOSITO');
                    // [ACCESORIOS] y con los accesorios de stock del pedido ya retirados (los recibe Producción)
                    await validarAccesoriosRecibidos(transaction, ordenesGate.recordset);
                }
            }

            let receivedCount = 0;
            const receivedOrdersSet = new Set();
            const recibidasIntermedias = new Set();

            for (const item of itemsRecibidos) {
                // Update Logistica_EnvioItems
                await new sql.Request(transaction)
                    .input('Est', sql.VarChar, item.estado)
                    .input('EID', sql.Int, envioId)
                    .input('BID', sql.Int, item.bultoId)
                    .query(`UPDATE Logistica_EnvioItems SET EstadoRecepcion = @Est, FechaEscaneo = GETDATE() WHERE EnvioID = @EID AND BultoID = @BID`);

                // Update Bulto Location logic
                if (item.estado === 'ESCANEADO') {
                    await new sql.Request(transaction)
                        .input('Ubi', sql.VarChar, areaReceptora)
                        .input('BID', sql.Int, item.bultoId)
                        .query(`UPDATE Logistica_Bultos SET Estado = 'EN_STOCK', UbicacionActual = @Ubi WHERE BultoID = @BID`);

                    // UPDATE INVENTARIO (SYNC OR CREATE)
                    // 1. Get Code
                    const codeReq = await new sql.Request(transaction).input('BID', sql.Int, item.bultoId).query("SELECT CodigoEtiqueta FROM Logistica_Bultos WHERE BultoID = @BID");
                    const code = codeReq.recordset[0]?.CodigoEtiqueta;

                    // SCOPED VARIABLES
                    let bultoInfo = {};
                    let CodigoEtiqueta = null;
                    let OrdenID = null;

                    if (code) {
                        // 1. Get Extended Data (Try Order first, then Reception)
                        // This logic handles both internal Orders (linked in Logistica_Bultos) and Client Fabrics (Linked to Recepciones via Code)
                        const extData = await new sql.Request(transaction).input('BID', sql.Int, item.bultoId).input('Code', sql.VarChar, code)
                            .query(`
                            SELECT
                                b.CodigoEtiqueta,
                                b.OrdenID,
                                b.Descripcion,
                                b.Tipocontenido,
                                -- [COMBOS] Si el bulto es la ancla de retiro de un combo, su NoDocERP es
                                -- el de la venta VEN- (no el del pedido real) — el auto-fulfill de más
                                -- abajo (busca la orden a desbloquear por NoDocERP+AreaID) nunca
                                -- encontraría la hermana real sin este COALESCE. Sin combo,
                                -- ComboPedidoNoDocERP es siempre NULL — no-op.
                                COALESCE(o.ComboPedidoNoDocERP, o.NoDocERP) AS NoDocERP,
                                r.Referencias, -- Fetch raw references
                                COALESCE(o.Cliente, r.Cliente) as Cliente,
                                r.RecepcionID,
                                r.Tipo AS TipoRecepcion
                            FROM Logistica_Bultos b
                            -- Encomiendas: OrdenID = N° de OrdenesRetiro → sin el filtro, el
                            -- check-in tomaba Cliente/NoDocERP de una orden NUEVA ajena.
                            LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
                            LEFT JOIN Recepciones r ON b.CodigoEtiqueta = r.Codigo
                            WHERE b.BultoID = @BID
                        `);

                        bultoInfo = extData.recordset[0] || {};
                        CodigoEtiqueta = bultoInfo.CodigoEtiqueta;

                        // Parse OrdenID from Referencias manually to be safer
                        OrdenID = bultoInfo.OrdenID;
                        if (!OrdenID) {
                            // Try to extract "Ord: 1234" from desc/ref
                            const combined = (bultoInfo.Referencias || '') + ' ' + (bultoInfo.Descripcion || '');
                            const match = combined.match(/Ord(?:en)?:?\s*(\d+)/i);
                            if (match) OrdenID = parseInt(match[1]);
                        }
                        
                        if (OrdenID && areaReceptora === 'DEPOSITO' && item.estado === 'ESCANEADO' && bultoInfo.Tipocontenido !== 'ENCOMIENDA') {
                            receivedOrdersSet.add(Number(OrdenID));
                        }

                        // [TELA CLIENTE] Devolución de excedente: recién ACÁ, cuando el bulto llega
                        // de verdad a depósito, la orden queda "lista para retirar" (igual que
                        // cualquier orden normal) y se avisa al cliente — el retiro/encomienda real
                        // todavía NO se crea: nace después, cuando el cliente la retira de verdad
                        // por el circuito normal (portal/tótem/WebRetirosPage). Conexión propia,
                        // best-effort: si falla no aborta la recepción del remito, solo queda
                        // logueado para revisar a mano — mismo patrón que el bloque de contabilidad
                        // WMS de más abajo (poolLocal fuera de la transacción).
                        if (OrdenID && areaReceptora === 'DEPOSITO' && item.estado === 'ESCANEADO' && bultoInfo.Tipocontenido === 'DEV_TELA_CLIENTE') {
                            try {
                                const devolucionSvc = require('../services/telaClienteDevolucionFisicaService');
                                const poolDevolucion = await getPool();
                                const resDev = await devolucionSvc.finalizarLlegadaDeposito(poolDevolucion, { ordenId: Number(OrdenID), usuarioId });
                                // Sin este emit, el dashboard/portal del cliente no se entera de que ya
                                // tiene algo listo para retirar hasta que alguien refresca a mano.
                                if (resDev?.ok) {
                                    const io = req.app.get('socketio');
                                    if (io) io.emit('actualizado', { type: 'actualizacion' });
                                }
                            } catch (eDev) {
                                logger.warn(`[RECEIVE-DISPATCH] No se pudo finalizar la devolución de tela cliente (Orden ${OrdenID}): ${eDev.message}`);
                            }
                        }

                        // [PRENDAS] Recepción en un área INTERMEDIA (no Depósito): la orden que mandó
                        // el bulto queda 'En transito' para siempre si nadie la cierra acá — nada más
                        // la avanza. Se junta para procesar después del loop (ver más abajo), igual
                        // patrón que receivedOrdersSet pero sin la contabilidad/gate de Depósito.
                        if (OrdenID && areaReceptora && areaReceptora !== 'DEPOSITO' && item.estado === 'ESCANEADO' && bultoInfo.Tipocontenido !== 'ENCOMIENDA') {
                            recibidasIntermedias.add(Number(OrdenID));
                        }

                        // CHECK-IN EN TERMINAC: al recibir el material impreso, la orden hermana
                        // XEUV del mismo pedido pasa de 'Pendiente' a 'Material Recibido' — recién
                        // ahí queda disponible en la bandeja de terminaciones para trabajar.
                        // (Nunca con encomiendas: su OrdenID es el N° de OrdenesRetiro y el
                        // subselect por NoDocERP caería en una orden ajena.)
                        if (OrdenID && (areaReceptora || '').toUpperCase() === 'TERMINAC' && bultoInfo.Tipocontenido !== 'ENCOMIENDA') {
                            try {
                                const herRes = await new sql.Request(transaction)
                                    .input('OID', sql.Int, OrdenID)
                                    .query(`
                                        SELECT H.OrdenID FROM Ordenes H
                                        WHERE H.AreaID = 'TERMINAC' AND H.Estado NOT IN ('Cancelado')
                                          AND ISNULL(H.EstadoenArea, 'Pendiente') = 'Pendiente'
                                          AND H.NoDocERP = (SELECT NoDocERP FROM Ordenes WHERE OrdenID = @OID)
                                    `);
                                for (const her of herRes.recordset) {
                                    await changeOrderState(transaction, {
                                        target : { type: 'ORDER', id: her.OrdenID },
                                        estado : 'Material Recibido',
                                        userObj: req.user || 'Sistema',
                                        detalle: `Material impreso recibido en Terminaciones (bulto ${CodigoEtiqueta || item.bultoId})`,
                                        io     : req.app.get('socketio')
                                    });
                                    logger.info(`[Check-in TERMINAC] Orden ${her.OrdenID} -> Material Recibido (bulto ${CodigoEtiqueta})`);
                                }
                            } catch (eTer) {
                                logger.warn('[Check-in TERMINAC] No se pudo actualizar la hermana de terminaciones:', eTer.message);
                            }
                        }

                        const { Cliente } = bultoInfo;
                        logger.info("Resolved Order Data:", { OrdenID, Cliente, Ref: bultoInfo.Referencias });

                        // --- AUTO-FULFILL REQUIREMENT ON CHECK-IN ---
                        // La orden ancla DEV-xx (devolución de tela cliente) no tiene NoDocERP ni
                        // requisitos de producción reales — Tipocontenido incluye "TELA" y entraba
                        // igual al fallback de abajo, pisando en un bug preexistente (variable
                        // `NoDocERP` suelta, nunca declarada acá) porque bultoInfo.NoDocERP es NULL.
                        if (OrdenID && areaReceptora && bultoInfo.Tipocontenido !== 'DEV_TELA_CLIENTE') {
                            // --- LOGICA INTELIGENTE: ORIGEN -> ENTREGA ---
                            let reqTypeToFulfill = null;
                            let originAreaID = '';

                            // 1. Averiguar ORIGEN del Remito asociado
                            // bultoInfo NO trae BultoID (el SELECT de extData no lo pide) — quedaba
                            // undefined y esta consulta no encontraba NUNCA el remito, por lo que
                            // el auto-cumplimiento de requisitos por Origen→Entrega jamás disparaba
                            // (silenciosamente caía al fallback por Tipocontenido, que tampoco
                            // reconoce 'PROD_TERMINADO'). item.bultoId es el ID real del bulto que
                            // se está procesando en esta vuelta del loop.
                            const remitoRes = await new sql.Request(transaction)
                                .input('BID', sql.Int, item.bultoId)
                                .query(`
                                    SELECT TOP 1 e.AreaOrigenID, a.Entrega
                                    FROM Logistica_EnvioItems ei
                                    JOIN Logistica_Envios e ON ei.EnvioID = e.EnvioID
                                    LEFT JOIN Areas a ON e.AreaOrigenID = a.AreaID
                                    WHERE ei.BultoID = @BID
                                    ORDER BY e.EnvioID DESC
                                `);

                            if (remitoRes.recordset.length > 0) {
                                const row = remitoRes.recordset[0];
                                originAreaID = (row.AreaOrigenID || '').trim();
                                // Areas.Entrega es CHAR de ancho fijo (relleno con espacios, ej.
                                // 'PRENDAS   ') — sin el trim la normalización plural->singular de
                                // abajo (=== 'PRENDAS') nunca daba verdadero y el LIKE de más abajo
                                // jamás matcheaba nada: el requisito quedaba "Pendiente" para siempre
                                // aunque el check-in se hiciera perfecto.
                                if (row.Entrega && row.Entrega.trim()) {
                                    reqTypeToFulfill = row.Entrega.trim(); // Ej: 'DTF', 'PRENDAS', 'TELA'
                                    logger.info(`[AutoCheck] Requisito detectado por Origen ${originAreaID}: ${reqTypeToFulfill}`);
                                }
                            }

                            // FALLBACK (Usando .includes para TELA DE CLIENTE)
                            if (!reqTypeToFulfill) {
                                const tipoBulto = (bultoInfo.Tipocontenido || '').toUpperCase();
                                if (tipoBulto.includes('TELA') || tipoBulto.includes('INSUMO')) reqTypeToFulfill = 'TELA';
                                else if (tipoBulto.includes('PRENDA')) reqTypeToFulfill = 'PRENDA';
                                else if (tipoBulto.includes('DTF') || tipoBulto.includes('DISENO')) reqTypeToFulfill = 'DTF';
                                // [F1] Impresión Directa y Gran formato entregan tela impresa igual que Sublimación
                                else if (['SB', 'DIRECTA', 'ECOUV'].includes(originAreaID)) reqTypeToFulfill = 'TELA';
                            }

                            if (reqTypeToFulfill) {
                                const obsAuto = `Recibido en ${areaReceptora} ${originAreaID ? 'desde ' + originAreaID : ''} (Item: ${code})`;

                                // Ajuste para búsqueda LIKE
                                let searchPattern = reqTypeToFulfill;

                                // Normalización de Plurales/Sinónimos para coincidir con ConfigRequisitos
                                if (searchPattern === 'PRENDAS') searchPattern = 'PRENDA';
                                if (searchPattern === 'CORTES') searchPattern = 'CORTES';
                                if (searchPattern === 'DTF') searchPattern = 'DISENO'; // Si definimos que DTF satisface REQ-DISENO
                                // [ESTAMPADO 01/10] Cada Estampado se libera con SU transfer: el que estampa DTF
                                // espera "DTF a Estampar" y el que estampa TPU espera "TPU a Estampar" (requisito
                                // EST/TPU, docs/migrations/requisito_tpu_estampado.sql). Antes el TPU se trataba
                                // como DTF (vía DISENO): al llegar el TPU se cumplía "DTF a Estampar" en TODOS los
                                // Estampados del pedido y el del DTF quedaba liberado sin su transfer.
                                // Si el área receptora todavía no tiene el requisito TPU configurado (base sin
                                // migrar), se conserva el comportamiento anterior para no dejar órdenes trabadas.
                                if (searchPattern === 'TPU') {
                                    const tieneReqTpu = await new sql.Request(transaction)
                                        .input('Area', sql.VarChar(50), areaReceptora)
                                        .query(`SELECT TOP 1 1 AS x FROM ConfigRequisitosProduccion WHERE AreaID = @Area AND CodigoRequisito LIKE '%TPU%'`);
                                    if (!tieneReqTpu.recordset.length) searchPattern = 'DISENO';
                                }

                                // Query de cumplimiento
                                await new sql.Request(transaction)
                                    .input('OID', sql.Int, OrdenID)
                                    .input('Type', sql.VarChar(50), `%${searchPattern}%`)
                                    .input('Area', sql.VarChar(50), areaReceptora)
                                    .input('Doc', sql.VarChar, bultoInfo.NoDocERP || '')
                                    .input('Obs', sql.NVarChar(200), obsAuto)
                                    .query(`
                                        MERGE OrdenCumplimientoRequisitos AS target
                                        USING (
                                            SELECT DISTINCT req.RequisitoID, req.AreaID, dest.OrdenID
                                            FROM ConfigRequisitosProduccion req
                                            CROSS JOIN (
                                                SELECT OrdenID FROM Ordenes
                                                WHERE
                                                   (
                                                       (@Doc != '' AND NoDocERP = @Doc)
                                                       OR
                                                       (@Doc = '' AND NoDocERP = (SELECT TOP 1 NoDocERP FROM Ordenes WHERE OrdenID = @OID))
                                                       OR
                                                       (@Doc = '' AND OrdenID = @OID)
                                                       OR
                                                       -- [REQUISITOS] Encadenamiento explícito (TWC<-SB vía
                                                       -- selectedSubOrderId, TWT<-TWC/SB en "Fabricar a
                                                       -- Medida"): la orden destino puede depender de ESTA
                                                       -- orden origen puntual aunque sean pedidos distintos
                                                       -- (NoDocERP distinto) — mismo campo que ya resuelve
                                                       -- Estampado->su DTF/TPU encadenado.
                                                       LiberaCuandoOrdenID = @OID
                                                   )
                                                   AND AreaID = @Area
                                                   AND Estado != 'CANCELADO'
                                            ) dest
                                            WHERE (
                                                req.CodigoRequisito LIKE @Type
                                                OR (@Type LIKE '%DISENO%' AND req.CodigoRequisito LIKE '%DTF%')
                                                OR (@Type LIKE '%DTF%' AND req.CodigoRequisito LIKE '%DISENO%')
                                                -- [COSTURA SIN CORTE] Pedido sin orden de Corte: la tela llega directo de
                                                -- Sublimación/Directa a Costura. Lo que llega es TELA, y el requisito de
                                                -- Costura es CORTES ("Piezas Cortadas"): nunca coincidían y Costura quedaba
                                                -- "esperando requisitos" para siempre (COS-26025). Sin Corte en el pedido,
                                                -- la llegada de la tela cumple ese requisito.
                                                OR (@Type LIKE '%TELA%' AND req.CodigoRequisito = 'CORTES'
                                                    AND NOT EXISTS (SELECT 1 FROM Ordenes c
                                                                    WHERE c.NoDocERP = (SELECT NoDocERP FROM Ordenes WHERE OrdenID = @OID)
                                                                      AND c.AreaID = 'TWC' AND ISNULL(c.Estado, '') NOT IN ('CANCELADO', 'Cancelado')))
                                            )
                                            AND req.AreaID = @Area
                                        ) AS source
                                        ON (target.OrdenID = source.OrdenID AND target.RequisitoID = source.RequisitoID)
                                        -- un requisito que NO aplica a esa orden (ej. "TPU a Estampar" en el Estampado del DTF)
                                        -- se deja como está: lo que llegó es de la orden hermana, no de esta
                                        WHEN MATCHED AND NOT (target.Estado = 'CUMPLIDO' AND ISNULL(target.Observaciones, '') LIKE 'No aplica%') THEN
                                            UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = GETDATE(), Observaciones = @Obs
                                        WHEN NOT MATCHED THEN
                                            INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                                            VALUES (source.OrdenID, source.AreaID, source.RequisitoID, 'CUMPLIDO', GETDATE(), @Obs);
                                    `);
                            }
                        }

                        // --- [ACCESORIOS] AUTO-FULFILL "ACCESORIOS" DE LA ORDEN MADRE PRO ---
                        // El bulto recibido es el de un accesorio de stock (ancla VEN- "RETIRO ACCESORIO — …",
                        // ComboPedidoNoDocERP = pedido). Si con este ya no queda ningún accesorio del pedido sin
                        // bulto EN_STOCK en PRO, el requisito ACCESORIOS de la orden madre PRO pasa a CUMPLIDO.
                        if (OrdenID && String(areaReceptora || '').toUpperCase() === 'PRO' && item.estado === 'ESCANEADO') {
                            try {
                                const accInfo = await new sql.Request(transaction).input('OID', sql.Int, OrdenID).query(`
                                    SELECT LTRIM(RTRIM(ComboPedidoNoDocERP)) AS Doc FROM Ordenes
                                    WHERE OrdenID = @OID AND AreaID = 'PRO' AND EstadoDependencia = 'VENTA_DIRECTA'
                                      AND DescripcionTrabajo LIKE 'RETIRO ACCESORIO%' AND ComboPedidoNoDocERP IS NOT NULL`);
                                const docAcc = accInfo.recordset[0]?.Doc;
                                if (docAcc) {
                                    // Faltantes sin contar ESTE bulto (su ubicación se actualiza más adelante en este mismo loop)
                                    const faltanRes = await new sql.Request(transaction)
                                        .input('Doc', sql.VarChar(50), docAcc).input('OID', sql.Int, OrdenID).query(`
                                        SELECT COUNT(*) AS Faltan
                                        FROM Ordenes a
                                        LEFT JOIN PedidosCobranza pc ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(a.NoDocERP))
                                        WHERE a.AreaID = 'PRO' AND a.EstadoDependencia = 'VENTA_DIRECTA'
                                          AND a.DescripcionTrabajo LIKE 'RETIRO ACCESORIO%'
                                          AND LTRIM(RTRIM(a.ComboPedidoNoDocERP)) = @Doc
                                          AND a.OrdenID <> @OID
                                          AND ISNULL(pc.EstadoCobro, '') <> 'CANCELADO'
                                          AND NOT EXISTS (SELECT 1 FROM Logistica_Bultos b WHERE b.OrdenID = a.OrdenID AND b.Estado = 'EN_STOCK' AND b.UbicacionActual = 'PRO')`);
                                    if ((faltanRes.recordset[0]?.Faltan || 0) === 0) {
                                        await new sql.Request(transaction)
                                            .input('Doc', sql.VarChar(50), docAcc)
                                            .input('Obs', sql.NVarChar(300), `Accesorios de stock recibidos en PRO (último: ${code})`)
                                            .query(`
                                            MERGE OrdenCumplimientoRequisitos AS target
                                            USING (
                                                SELECT m.OrdenID, req.AreaID, req.RequisitoID
                                                FROM Ordenes m
                                                JOIN ConfigRequisitosProduccion req ON req.AreaID = 'PRO' AND req.CodigoRequisito = 'ACCESORIOS'
                                                WHERE LTRIM(RTRIM(m.NoDocERP)) = @Doc AND m.AreaID = 'PRO' AND ISNULL(m.EstadoDependencia, '') <> 'VENTA_DIRECTA'
                                            ) AS source
                                            ON (target.OrdenID = source.OrdenID AND target.RequisitoID = source.RequisitoID)
                                            WHEN MATCHED THEN
                                                UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = GETDATE(), Observaciones = @Obs
                                            WHEN NOT MATCHED THEN
                                                INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                                                VALUES (source.OrdenID, source.AreaID, source.RequisitoID, 'CUMPLIDO', GETDATE(), @Obs);`);
                                        logger.info(`[ACCESORIOS] Pedido ${docAcc}: todos los accesorios recibidos en PRO — requisito ACCESORIOS cumplido.`);
                                    }
                                }
                            } catch (eAccReq) { logger.warn('[ACCESORIOS] auto-cumplimiento en PRO: ' + eAccReq.message); }
                        }

                        // --- AUTO-FULFILL PRENDA DE CLIENTE (Recepción de mostrador sin OrdenID propia) ---
                        // Caso simétrico al de webOrdersController: ahí se cubre "la prenda ya
                        // había llegado cuando se creó el pedido"; acá, "el pedido ya existía y
                        // la prenda (Recepciones/PRE-xxx, sin bulto propio de ninguna orden —
                        // OrdenID NULL) llega recién ahora". El bloque de arriba no la alcanza:
                        // exige `OrdenID` en el bulto, y un "PAQUETE DE PRENDAS" de mostrador no
                        // tiene ninguna hasta que se reciba. Se vincula por
                        // Ordenes.PrendaClienteID -> InventarioPrendasCliente.RecepcionID (el
                        // cliente ya eligió esa línea al cargar el pedido), no por NoDocERP.
                        // Sin Recepción detrás del bulto (bultos normales de producción), no-op.
                        if (bultoInfo.RecepcionID && areaReceptora) {
                            try {
                                const reqPrenda3 = await new sql.Request(transaction)
                                    .input('Area', sql.VarChar(20), areaReceptora)
                                    .query(`SELECT RequisitoID FROM ConfigRequisitosProduccion WHERE AreaID = @Area AND CodigoRequisito = 'PRENDA'`);
                                if (reqPrenda3.recordset.length) {
                                    await new sql.Request(transaction)
                                        .input('RID', sql.Int, reqPrenda3.recordset[0].RequisitoID)
                                        .input('Area', sql.VarChar(20), areaReceptora)
                                        .input('RecID', sql.Int, bultoInfo.RecepcionID)
                                        .input('Obs', sql.NVarChar(300), `Recibida en ${areaReceptora} (Recepción ${CodigoEtiqueta || bultoInfo.RecepcionID})`)
                                        .query(`
                                            MERGE OrdenCumplimientoRequisitos AS target
                                            USING (
                                                SELECT DISTINCT o.OrdenID
                                                FROM Ordenes o
                                                JOIN InventarioPrendasCliente p ON p.PrendaClienteID = o.PrendaClienteID
                                                WHERE p.RecepcionID = @RecID AND o.AreaID = @Area AND ISNULL(o.Estado, '') <> 'Cancelado'
                                            ) AS source
                                            ON (target.OrdenID = source.OrdenID AND target.RequisitoID = @RID)
                                            WHEN MATCHED THEN
                                                UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = GETDATE(), Observaciones = @Obs
                                            WHEN NOT MATCHED THEN
                                                INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                                                VALUES (source.OrdenID, @Area, @RID, 'CUMPLIDO', GETDATE(), @Obs);
                                        `);
                                }
                            } catch (reqErr) {
                                logger.warn(`[Check-in ${areaReceptora}] No se pudo auto-cumplir PRENDA por Recepción ${bultoInfo.RecepcionID}: ${reqErr.message}`);
                            }
                        }

                        // Check if exists
                        const invCheck = await new sql.Request(transaction)
                            .input('C', sql.VarChar, code)
                            .query("SELECT BobinaID, CodigoEtiqueta FROM InventarioBobinas WHERE Referencia = @C OR CodigoEtiqueta = @C");

                        // [BORDADO] Un PRE de PAQUETE DE PRENDAS no es tela: sin esto cada paquete de
                        // prendas recibido en el área creaba una "bobina" fantasma de 100 m (el default)
                        // que después aparecía en Mis Recursos y en el form de Corte como tela del cliente.
                        const esPaquetePrendas = String(bultoInfo.TipoRecepcion || '').trim().toUpperCase() === 'PAQUETE DE PRENDAS';
                        const isCoilCandidate = code && !esPaquetePrendas && (code.startsWith('PRE-') || code.startsWith('BOB-'));

                        if (invCheck.recordset.length === 0 && isCoilCandidate) {
                            // CREATE (Alta en Inventario)
                            let mts = 100;
                            if (bultoInfo && bultoInfo.Referencias) {
                                const mMatch = bultoInfo.Referencias.match(/Mts:([\d\.]+)/);
                                if (mMatch) mts = parseFloat(mMatch[1]);
                            }

                            const newLabel = `BOB-${Date.now()}-${Math.floor(Math.random() * 100)}`;
                            logger.info("Creating NEW Bobina:", newLabel, "for Ref:", code, "Client:", Cliente, "Mts:", mts);

                            await new sql.Request(transaction)
                                .input('Ubi', sql.VarChar, areaReceptora)
                                .input('Ref', sql.VarChar, code)
                                .input('NewCode', sql.VarChar, newLabel)
                                .input('Cli', sql.VarChar, Cliente || null)
                                .input('Ord', sql.Int, OrdenID || null)
                                .input('Mts', sql.Decimal(10, 2), mts)
                                .query(`
                                    INSERT INTO InventarioBobinas 
                                    (InsumoID, AreaID, CodigoEtiqueta, Referencia, ClienteID, OrdenID, MetrosIniciales, MetrosRestantes, Estado, FechaIngreso, LoteProveedor)
                                    SELECT TOP 1 InsumoID, @Ubi, @NewCode, @Ref, @Cli, @Ord, @Mts, @Mts, 'Disponible', GETDATE(), 'INGRESO-CHECKIN'
                                    FROM Insumos 
                                    WHERE EsProductivo = 1 
                                    ORDER BY InsumoID ASC
                                `);

                            // [DISABLED] SYNC Logistica_Bultos & BAJA ORIGINAL - User Request: Avoid Duplicates in Logistics View
                            // The Coil (BOB) exists in Inventory only. The original Pack (PRE) remains in Logistics.

                            // 1. UPDATE LOGISTICS FOR ORIGINAL PACK (PRE) 
                            // Ensure it's marked as received in the area
                            if (code) {
                                await new sql.Request(transaction)
                                    .input('Ubi', sql.VarChar, areaReceptora)
                                    .input('C', sql.VarChar, code)
                                    .query("UPDATE Logistica_Bultos SET UbicacionActual = @Ubi, Estado = 'EN_STOCK' WHERE CodigoEtiqueta = @C");

                                await registrarMovimiento(transaction, {
                                    codigoBulto: code, tipo: 'INGRESO', area: areaReceptora, usuario: usuarioId,
                                    obs: 'Check-In (Linked to Inv)', estAnt: null, estNew: 'EN_STOCK', esRecep: true
                                });
                            }
                        } else if (invCheck.recordset.length === 0) {
                            // CASO: Item NO es Bobina/Insumo (ej. Producto Terminado SB, EMB, etc)
                            // Solo actualizamos Logística, no Inventario de Bobinas.
                            logger.info("Check-In Non-Coil Item (Product):", code);

                            await new sql.Request(transaction)
                                .input('Ubi', sql.VarChar, areaReceptora)
                                .input('C', sql.VarChar, code)
                                .query("UPDATE Logistica_Bultos SET UbicacionActual = @Ubi, Estado = 'EN_STOCK' WHERE CodigoEtiqueta = @C");

                            await registrarMovimiento(transaction, {
                                codigoBulto: code,
                                tipo: 'INGRESO',
                                area: areaReceptora,
                                usuario: usuarioId,
                                obs: 'Ingreso Producto',
                                estAnt: null,
                                estNew: 'EN_STOCK',
                                esRecep: true
                            });

                        } else {
                            // UPDATE (Movimiento y Normalizacion)
                            const existing = invCheck.recordset[0];
                            let targetCode = existing.CodigoEtiqueta;

                            // Si el código actual ES un PRE de Recepcion, lo migramos a BOB. Si es otra cosa (SB, EMB), lo dejamos.
                            if (targetCode.startsWith('PRE-')) {
                                targetCode = `BOB-${Date.now()}-${Math.floor(Math.random() * 100)}`;
                                logger.info("Renaming Legacy Bobina:", existing.CodigoEtiqueta, "->", targetCode);
                            }

                            logger.info("Updating Bobina:", targetCode, "Client:", Cliente);

                            await new sql.Request(transaction)
                                .input('Ubi', sql.VarChar, areaReceptora)
                                .input('Ref', sql.VarChar, code)
                                .input('Cli', sql.VarChar, Cliente || null)
                                .input('Ord', sql.Int, OrdenID || null)
                                .input('FinalCode', sql.VarChar, targetCode)
                                .input('BID', sql.Int, existing.BobinaID)
                                .query(`
                                    UPDATE InventarioBobinas 
                                    SET AreaID = @Ubi,
                                        CodigoEtiqueta = @FinalCode,
                                        Referencia = @Ref,
                                        ClienteID = ISNULL(@Cli, ClienteID),
                                        OrdenID = ISNULL(@Ord, OrdenID)
                                    WHERE BobinaID = @BID
                                `);

                            // SYNC Logistica_Bultos
                            await new sql.Request(transaction)
                                .input('Cod', sql.VarChar, targetCode)
                                .input('Ubi', sql.VarChar, areaReceptora)
                                .query("UPDATE Logistica_Bultos SET UbicacionActual = @Ubi, Estado = 'EN_STOCK' WHERE CodigoEtiqueta = @Cod");

                            // Log Movimiento
                            await registrarMovimiento(transaction, {
                                codigoBulto: targetCode,
                                tipo: 'INGRESO',
                                area: areaReceptora,
                                usuario: usuarioId,
                                obs: `Check-in en ${areaReceptora}`,
                                estAnt: 'EN_TRANSITO',
                                estNew: 'EN_STOCK',
                                esRecep: true
                            });
                        }
                    }

                    receivedCount++;

                    /* 
                    // --- REQUIREMENTS ENGINE (DISABLED FOR MANUAL VALIDATION) ---
                    // Se reactivará como "Sugerencia" en la UI más adelante
                    if (OrdenID) {
                        // Logic commented out to prevent auto-save
                    }
                    */
                } else if (item.estado === 'PERDIDO') {
                    // MARCAR COMO PERDIDO EN MAESTRO DE BULTOS
                    await new sql.Request(transaction)
                        .input('BID', sql.Int, item.bultoId)
                        .query(`UPDATE Logistica_Bultos SET Estado = 'PERDIDO', UbicacionActual = 'EXTRAVIADO' WHERE BultoID = @BID`);

                    // Log Movement
                    await new sql.Request(transaction)
                        .input('BID', sql.Int, item.bultoId)
                        .query("INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones) SELECT CodigoEtiqueta, 'PERDIDA', 'EXTRAVIADO', 1, 'Reportado como perdido en Recepción' FROM Logistica_Bultos WHERE BultoID = @BID");
                }
            }

            // [PRENDAS] Cerrar en su área de ORIGEN cada orden cuyo bulto se acaba de recibir en una
            // área intermedia (no Depósito, que tiene su propio flujo de 'Ingresado' + contabilidad
            // más abajo). Sin esto, la orden queda 'En transito' para siempre y la Hoja de Ruta la
            // muestra como "en producción" aunque ya se haya entregado del todo en esa área. Guard
            // "EstadoenArea = 'En transito'": si por lo que sea la orden no estaba en ese estado
            // (ej. re-escaneo, o el bulto no vino de un despacho normal), no se toca nada.
            for (const oid of recibidasIntermedias) {
                await changeOrderState(transaction, {
                    target : { type: 'ORDER', id: oid },
                    estado : 'Recibido en Destino',
                    userObj: req.user || req.body.usuario || usuarioId || 'Sistema',
                    detalle: `Bulto recibido en ${areaReceptora}`,
                    guard  : "EstadoenArea = 'En transito'",
                    io     : req.app.get('socketio'),
                });
                // [BULTO COMPARTIDO 01/10] La hermana sin bulto propio llegó dentro de este bulto: se cierra con
                // ella. Acepta 'Pronto' además de 'En transito' para los remitos armados antes de este cambio.
                const llegaron = await hermanasSinBultoPropio(transaction, oid, ['En transito', 'Pronto'], 'Recibido en Destino');
                for (const hv of llegaron) {
                    await changeOrderState(transaction, {
                        target : { type: 'ORDER', id: hv.OrdenID },
                        estado : 'Recibido en Destino',
                        userObj: req.user || req.body.usuario || usuarioId || 'Sistema',
                        detalle: `Recibida en ${areaReceptora} dentro del bulto de ${hv.CodigoPortadora}`,
                        guard  : "EstadoenArea IN ('En transito', 'Pronto')",
                        io     : req.app.get('socketio'),
                    });
                }
            }

            // Spec 39: si el remito traía complementos de reposición, al llegar al área que los cierra
            // la reposición pasa a CERRADA, se libera el eslabón siguiente de la cadena y la orden que
            // reportó vuelve a estar operable cuando no le queda nada abierto.
            if (envioId) {
                try {
                    await reposicionesService.alRecibirEnvio(transaction, envioId, areaReceptora, req.user || req.body.usuario || usuarioId || 'Sistema', req.app.get('socketio'));
                } catch (eRep) { logger.warn('[receiveDispatch] reposiciones al recibir:', eRep.message); }
            }

            // Check if full reception (solo si hay remito; el forzar-puro desde la bandeja no trae envioId)
            let newStatus = 'RECIBIDO_TOTAL';
            if (envioId) {
                const check = await new sql.Request(transaction).input('EID', sql.Int, envioId)
                    .query("SELECT COUNT(*) as Total, SUM(CASE WHEN EstadoRecepcion != 'PENDIENTE' THEN 1 ELSE 0 END) as Processed FROM Logistica_EnvioItems WHERE EnvioID = @EID");

                const { Total, Processed } = check.recordset[0];
                newStatus = (Processed >= Total) ? 'RECIBIDO_TOTAL' : 'RECIBIDO_PARCIAL';

                await new sql.Request(transaction)
                    .input('Est', sql.VarChar, newStatus)
                    .input('UID', sql.Int, usuarioId)
                    .input('EID', sql.Int, envioId)
                    .query(`UPDATE Logistica_Envios SET Estado = @Est, UsuarioReceptor = @UID, FechaLlegada = GETDATE() WHERE EnvioID = @EID`);
            }

            // --- REWORK "ESPERAR TODOS LOS BULTOS": gate por PEDIDO (NoDocERP) ---
            // El pedido completo (todas sus órdenes hermanas no canceladas) debe tener TODOS sus
            // bultos PROD_TERMINADO "vivos" en el depósito para ingresar/contabilizar/avisar.
            // "Vivos" = Estado <> 'PROCESADO': excluye los bultos que la orden dejó en áreas
            // intermedias al transformarse (auto-consume) — no se espera nada de áreas anteriores.
            // Hasta completarse, las órdenes quedan en estado 13. Forzar una orden fuerza el pedido.
            // Cuando el pedido completa, se procesan TODAS las hermanas (también las recibidas antes).
            const forzarSet = new Set((forzarOrdenes || []).map(Number).filter(n => !isNaN(n)));
            // Spec 39 (INV-FLT.01): "Forzar ingreso" queda solo para bultos físicos extraviados con el
            // libro completo. Nunca saltea reposiciones abiertas, solicitudes abiertas ni envíos parciales.
            if (areaReceptora === 'DEPOSITO' && forzarSet.size > 0) {
                const ordsForzar = await new sql.Request(transaction).query(`
                    SELECT OrdenID, CodigoOrden, NoDocERP, AreaID FROM Ordenes WHERE OrdenID IN (${[...forzarSet].join(',')})`);
                await validarLibroParaDeposito(transaction, ordsForzar.recordset);
            }
            // Forzar-puro: las órdenes forzadas se procesan aunque no vinieran bultos nuevos en esta llamada
            if (areaReceptora === 'DEPOSITO') for (const oid of forzarSet) receivedOrdersSet.add(oid);
            const ordenBultos = {};          // OrdenID -> { esperados, recibidos, lista } (números del PEDIDO)
            const expandidas = new Set();    // hermanas sumadas al completarse el pedido (no escaneadas ahora)
            let ordenesProcesar = [...receivedOrdersSet];
            if (areaReceptora === 'DEPOSITO' && receivedOrdersSet.size > 0) {
                const procesarSet = new Set([...receivedOrdersSet].map(Number).filter(n => !isNaN(n)));
                const idsIn = [...procesarSet].join(',');

                // Pedido (NoDocERP) de cada orden tocada
                const ordenPedido = {};
                if (idsIn.length > 0) {
                    const pedRes = await new sql.Request(transaction).query(`
                        SELECT OrdenID, LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) AS NoDoc
                        FROM Ordenes WHERE OrdenID IN (${idsIn})
                    `);
                    for (const r of pedRes.recordset) ordenPedido[r.OrdenID] = (r.NoDoc && r.NoDoc.length) ? r.NoDoc : null;
                }

                // Gate por pedido: bultos que se esperan de TODAS las hermanas y cuántos llegaron.
                // La regla (qué bultos ya no van a llegar, reposiciones, fallas -F) vive en
                // bultosPedidoService, la misma que usa la bandeja "Esperando Bultos".
                const pedidos = [...new Set(Object.values(ordenPedido).filter(Boolean))];
                const conteoPedidos = await bultosPedido.contarBultos(transaction, { noDocs: pedidos });
                for (const noDoc of pedidos) {
                    const c = conteoPedidos.get(`P:${noDoc}`) || { esperados: 0, recibidos: 0, ordenIds: [] };
                    const espPed = c.esperados;
                    const recPed = c.recibidos;
                    const forzado = c.ordenIds.some(id => forzarSet.has(Number(id)));
                    const completoFisico = espPed > 0 && recPed >= espPed;
                    // espPed === 0: sin bultos de producto terminado que esperar (ej. recepción de insumos) → no se gatea
                    const lista = forzado || completoFisico || espPed === 0;
                    for (const id of c.ordenIds) {
                        const roid = Number(id);
                        ordenBultos[roid] = { esperados: espPed, recibidos: recPed, lista };
                        if ((forzado || completoFisico) && !procesarSet.has(roid)) {
                            procesarSet.add(roid);
                            expandidas.add(roid);   // hermana recibida antes: ahora se ingresa junto al pedido
                        }
                    }
                }

                // Órdenes sin pedido (NoDocERP NULL): gate por la propia orden
                const sinPedido = [...procesarSet].filter(oid => !ordenPedido[oid] && !ordenBultos[oid]);
                const conteoSueltas = await bultosPedido.contarBultos(transaction, { ordenIds: sinPedido });
                for (const oid of sinPedido) {
                    const c = conteoSueltas.get(`O:${Number(oid)}`) || { esperados: 0, recibidos: 0 };
                    const lista = forzarSet.has(Number(oid)) || c.esperados === 0 || c.recibidos >= c.esperados;
                    ordenBultos[oid] = { esperados: c.esperados, recibidos: c.recibidos, lista };
                }

                ordenesProcesar = [...procesarSet];
            }

            // ==========================================
            // LOGICA CONTABLE WMS (PUNTO DE CHECKING)
            // ==========================================
            if (areaReceptora === 'DEPOSITO') {
                try {
                    const poolLocal = await getPool(); // Fuera de la transaccion WMS
                    // Órdenes a procesar: escaneadas + forzadas + hermanas del pedido cuando el pedido
                    // quedó completo (se ingresan/contabilizan todas juntas, una sola vez por orden).
                    const ordenesAContab = [...new Set(ordenesProcesar.map(Number))].filter(n => !isNaN(n));

                    // Las madres antes que sus reposiciones (-R) y fallas (-F). Cada orden cobra solo SUS
                    // líneas del pedido. Una -R no tiene líneas propias, así que no asienta nada; se deja
                    // para el final igual, para que los logs del ingreso sigan el orden madre → reposición.
                    if (ordenesAContab.length > 1) {
                        const codsRes = await poolLocal.request().query(
                            `SELECT OrdenID, CodigoOrden FROM Ordenes WITH(NOLOCK) WHERE OrdenID IN (${ordenesAContab.join(',')})`);
                        const esRepoOFalla = new Map(codsRes.recordset.map(r =>
                            [Number(r.OrdenID), /-[RF]\d+$/i.test(String(r.CodigoOrden || '').trim())]));
                        ordenesAContab.sort((a, b) => (esRepoOFalla.get(a) ? 1 : 0) - (esRepoOFalla.get(b) ? 1 : 0));
                    }

                    // Pedidos que se asentaron en ESTA pasada: sus hermanas (las otras partes del mismo
                    // pedido, que entran juntas cuando el pedido se completa) se asientan cada una con
                    // sus líneas, aunque el pedido ya haya quedado marcado por la primera.
                    const pedidosAsentadosEnEstaPasada = new Set();

                    for (const L_OrdenID of ordenesAContab) {
                        // --- GATE ESPERAR BULTOS: si la orden aún no tiene todos sus bultos, no contabilizar ---
                        if (ordenBultos[L_OrdenID] && !ordenBultos[L_OrdenID].lista) continue;
                        
                        const oData = await poolLocal.request().input('OID', require('mssql').Int, L_OrdenID).query("SELECT Cliente, CodCliente, CliIdCliente, CodigoOrden, DescripcionTrabajo, ProIdProducto, AreaID, TRY_CAST(Magnitud AS FLOAT) AS Magnitud FROM Ordenes WITH(NOLOCK) WHERE OrdenID = @OID");
                        if (oData.recordset.length === 0) continue;
                        const oRow = oData.recordset[0];
                        const logPrefix = `[CONTABILIDAD-WMS] [${oRow.CodigoOrden}] ${oRow.DescripcionTrabajo.substring(0,30)}`;

                        // [POR ÁREA] Pedido cobrado por área ([FACTURA POR AREA] en la PRO madre): cada área
                        // tiene su línea, pero lo único que entra a Depósito es la madre. La madre cobra TODAS
                        // las líneas del pedido; sus hermanas (Bordado, DTF…) no cobran nada propio — si no,
                        // la primera en pasar marcaba el pedido como contabilizado y el resto quedaba sin cobrar.
                        let esMadrePorArea = false;
                        let pedidoPorArea = false;
                        try {
                            const mpa = await poolLocal.request().input('OID', require('mssql').Int, L_OrdenID).query(`
                                SELECT TOP 1 m.OrdenID FROM Ordenes o WITH(NOLOCK)
                                JOIN Ordenes m WITH(NOLOCK) ON LTRIM(RTRIM(CAST(m.NoDocERP AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50))))
                                 AND m.AreaID = 'PRO' AND m.ComboItemID IS NULL AND ISNULL(m.EstadoDependencia, '') <> 'VENTA_DIRECTA'
                                 AND m.Nota LIKE '%[[]FACTURA POR AREA]%'
                                WHERE o.OrdenID = @OID AND o.NoDocERP IS NOT NULL
                                ORDER BY m.OrdenID`);
                            const madreId = mpa.recordset[0]?.OrdenID ? Number(mpa.recordset[0].OrdenID) : null;
                            pedidoPorArea = !!madreId;
                            if (madreId === Number(L_OrdenID)) esMadrePorArea = true;
                            else if (madreId && ordenesAContab.includes(madreId)) {
                                console.log(`${logPrefix} -> Hermana de pedido por área: cobra la madre PRO, se omite acá`);
                                continue;
                            }
                        } catch (eMpa) { logger.warn(`[DEPOSITO] ${oRow.CodigoOrden}: no se pudo ver si el pedido es por área: ${eMpa.message}`); }

                        // 2. Buscar en PedidosCobranza
                        const pcReq = await poolLocal.request().input('OID', require('mssql').Int, L_OrdenID)
                            .query("SELECT ID, MontoTotal, NoDocERP, MontoContabilizado, MetrosContabilizados, Moneda FROM PedidosCobranza WITH(NOLOCK) WHERE NoDocERP = (SELECT TOP 1 LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR))) FROM Ordenes WITH(NOLOCK) WHERE OrdenID = @OID)");

                        console.log(`${logPrefix} -> Encontrado PedidoCobranza =`, pcReq.recordset.length > 0);
if (pcReq.recordset.length > 0) {
                            const pc = pcReq.recordset[0];
                            const currentMonto = parseFloat(pc.MontoTotal) || 0;
                            const mContado = parseFloat(pc.MontoContabilizado) || 0;
                            const metContado = parseFloat(pc.MetrosContabilizados) || 0;

                            const detReq = await poolLocal.request().input('PID', require('mssql').Int, pc.ID)
                                .query("SELECT SUM(CASE WHEN Cantidad IS NULL THEN 0 ELSE Cantidad END) as Metros FROM PedidosCobranzaDetalle WITH(NOLOCK) WHERE PedidoCobranzaID = @PID");
                            const totalMetros = detReq.recordset.length > 0 ? (parseFloat(detReq.recordset[0].Metros) || 0) : 0;

                            const finalMonId = (pc.Moneda === 'USD') ? 2 : 1;

                            // Cliente REAL, una sola vez para cargo/planes de esta orden.
                            // null = el cliente no existe: los asientos se OMITEN (con error en log).
                            const cliPKReal = await resolverCliPK(poolLocal, oRow.CliIdCliente, oRow.CodCliente);
                            if (!cliPKReal) {
                                logger.error(`[DEPOSITO] ${oRow.CodigoOrden}: el cliente no existe (CodCliente ${String(oRow.CodCliente || '').trim()}) — se omiten los asientos contables. ¿Cliente eliminado?`);
                            }

                            // ¿Se asienta ESTA orden? El control es por orden (ver estadoAsientoOrden):
                            // - Si ya tiene movimientos propios, ya está asentada y no se toca. Un cambio de
                            //   precio posterior lo lleva la cotización, orden por orden
                            //   (propagarCotizacionADeposito). Acá había una "reversa" que mandaba el importe
                            //   en negativo, pero el motor registra |Importe| con el signo del evento: la
                            //   reversa era OTRO débito (13 entre julio y setiembre, casi todos en -R).
                            // - Si el pedido se asentó en una pasada ANTERIOR y esta orden no tiene
                            //   movimientos, puede ser una hermana que quedó sin asentar, o un pedido cobrado
                            //   entero en otra orden (así se asentaba hasta el 22/07, y la cotización llevaba
                            //   el cargo al total del pedido). Se asienta solo si lo ya cargado al pedido no
                            //   llega a su total.
                            // Reposiciones (-R) y fallas (-F) son re-trabajo sin cargo: no se asientan nunca.
                            const esRepoOFallaIngreso = /-[RF]\d+$/i.test(String(oRow.CodigoOrden || '').trim());
                            let asentar = !esRepoOFallaIngreso && (currentMonto !== 0 || totalMetros > 0);
                            if (asentar && cliPKReal) {
                                const est = await estadoAsientoOrden(poolLocal, {
                                    ordenId: L_OrdenID, codigoOrden: oRow.CodigoOrden, cliId: cliPKReal,
                                    pedidoId: pc.ID, noDocERP: pc.NoDocERP, monId: finalMonId,
                                });
                                const pedidoDeOtraPasada = (mContado !== 0 || metContado !== 0) && !pedidosAsentadosEnEstaPasada.has(pc.ID);
                                if (est.propios > 0) {
                                    asentar = false;
                                    console.log(`${logPrefix} -> Ya asentada (${est.propios} movimiento/s propio/s): no se vuelve a asentar`);
                                } else if (est.lineasConOrden === 0 && (mContado !== 0 || metContado !== 0 || pedidosAsentadosEnEstaPasada.has(pc.ID))) {
                                    // Pedido viejo sin OrdenID en sus líneas: la primera orden asienta el pedido
                                    // entero (lineasContab = todo el pedido), así que las demás no asientan nada.
                                    asentar = false;
                                    console.log(`${logPrefix} -> Pedido sin desglose por orden, ya asentado por otra orden`);
                                } else if (pedidoDeOtraPasada && currentMonto > 0 && est.cargadoPedido >= currentMonto - 0.05) {
                                    asentar = false;
                                    const msg = `[DEPOSITO] ${oRow.CodigoOrden}: el pedido ${pc.NoDocERP} ya tiene cargados ${est.cargadoPedido.toFixed(2)} de ${currentMonto.toFixed(2)} en otras órdenes — esta no se asienta.`;
                                    // Sin líneas propias no había nada que asentar: no hace falta avisar.
                                    if (est.lineasPropias > 0) logger.warn(`${msg} Si le faltan metros del plan, revisar a mano.`);
                                    else console.log(msg);
                                }
                            }

                            console.log(`${logPrefix} -> Asentar=${asentar}, totalMetros=${totalMetros}, currentMonto=${currentMonto}, mContado=${mContado}, metContado=${metContado}`);
if (asentar) {
                                    // ¿Cliente "Rollo por adelantado"? Su plan activo cubre SIEMPRE al ingresar,
                                    // aunque el saldo esté en 0 o negativo (el hook deja el plan en rojo y la
                                    // próxima recarga lo absorbe). Se resuelve UNA vez por orden.
                                    let esClienteRollo = false;
                                    if (cliPKReal) {
                                        try {
                                            const tcCk = await poolLocal.request()
                                                .input('CliR', require('mssql').Int, cliPKReal)
                                                .query(`SELECT UPPER(ISNULL(tc.TClDescripcion,'')) AS T
                                                        FROM dbo.Clientes c WITH(NOLOCK)
                                                        LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
                                                        WHERE c.CliIdCliente = @CliR`);
                                            esClienteRollo = /ROLLO|SEMANAL/.test(tcCk.recordset[0]?.T || '');
                                        } catch (eTc) { /* ante la duda, comportamiento histórico */ }
                                    }

                                    // Asiento de las líneas de esta orden
                                         console.log(`${logPrefix} -> Generando nuevo cargo`); // por ${currentMonto}`);
                                         const cRes = await poolLocal.request().query("SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC");
                                         const cotizacionVal = cRes.recordset[0]?.CotDolar || 40;

                                         const details = await poolLocal.request().input('PID', require('mssql').Int, pc.ID).query("SELECT Cantidad, Subtotal as TotalLinea, ProIdProducto as IDProdReact, Moneda, OrdenID, PrecioUnitario, PrecioUnitarioOriginal, MonedaOriginal, PerfilAplicado, ISNULL(EsHermanaConsolidada, 0) AS EsHermanaConsolidada FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PID");
                                           
                                           // --- EN ESTE PUNTO LA ORDEN YA LLAMÓ AL CHECKIN WMS, INSERTAMOS EN ORDENESDEPOSITO SI FALTA ---
                                           // Las fallas (-F) son internas: su material se incorpora a la madre,
                                           // no deben crear registro propio en OrdenesDeposito (sino el job WSP las avisaría).
                                           const esFallaInterna = (oRow.CodigoOrden || '').includes('-F');
                                           // Las hermanas de terminaciones (XEUV, área TERMINAC) son igual de internas:
                                           // contienen el TRABAJO de terminación, no un producto aparte. Lo que el
                                           // cliente retira es la orden madre (EUV) con su cantidad e importe. Si
                                           // entraran a OrdenesDeposito, el retiro mostraría una línea fantasma
                                           // (cant 1, costo 0) y el job de WhatsApp avisaría el pedido dos veces.
                                           const esHermanaTerminac = (oRow.AreaID || '').trim().toUpperCase() === 'TERMINAC';
                                           // [PRENDAS] Bordado/DTF/TPU/Estampado/Corte/Costura de una prenda comprada
                                           // + personalizada: la que factura y avisa es SIEMPRE la orden madre PRO,
                                           // nunca la hermana — mismo trato que TERMINAC arriba, pero acá SE
                                           // REDIRIGE a la madre en vez de no crear nada: con varias hermanas
                                           // convergiendo en Depósito por separado (ej. Estampado partido en 1/2 y
                                           // 2/2), si la que llega de última fuera simplemente excluida, el pedido
                                           // se quedaba sin ningún registro — sin cobrar ni avisar por WhatsApp.
                                           const ordenDeposito = (esFallaInterna || esHermanaTerminac)
                                               ? null
                                               : await resolverOrdenParaDeposito(poolLocal, L_OrdenID, oRow.CodigoOrden);

                                           if (ordenDeposito) {
                                               const depCheck = await poolLocal.request().input('Cod', require('mssql').VarChar, ordenDeposito.codigoOrden)
                                                   .query("SELECT OrdIdOrden FROM OrdenesDeposito WITH(NOLOCK) WHERE OrdCodigoOrden = @Cod");

                                               if (depCheck.recordset.length === 0 && details.recordset.length > 0) {
                                               // Línea de cobranza de ESTA orden (o de la madre, si se redirigió) — no
                                               // del pedido completo: cada orden hermana entra con su propio
                                               // importe/cantidad/producto para no duplicar el total en el retiro.
                                               // Fallback al comportamiento previo si el detalle no tuviera la orden desglosada.
                                               // Reposiciones cliente (-R): NUNCA tienen línea propia en PedidosCobranzaDetalle y el
                                               // fallback a la 1ª línea del pedido les copiaba el costo de la MADRE (el retiro les
                                               // mostraba importe). Son re-trabajo sin cargo: siempre costo 0 y su propia cantidad.
                                               const esRepoCliente = /-R\d+$/i.test(oRow.CodigoOrden || '');
                                               // TODAS las líneas de esta orden, no la primera: un pedido ECOUV trae la
                                               // impresión y cada terminación en su propia línea. Quedarse con una sola
                                               // perdía las terminaciones (EUV-14157: 18.00 en vez de 39.98).
                                               const propiasDeLaOrden = esRepoCliente ? [] : details.recordset.filter(d => Number(d.OrdenID) === Number(ordenDeposito.ordenId));
                                               // Pedidos legacy sin OrdenID desglosado: se mantiene el fallback a la 1ª línea.
                                               const lineasDeLaOrden = esRepoCliente
                                                   ? []
                                                   : (propiasDeLaOrden.length > 0 ? propiasDeLaOrden : (details.recordset[0] ? [details.recordset[0]] : []));
                                               // Cada línea puede venir en otra moneda que la cabecera (impresión USD +
                                               // terminaciones UYU): sumar en crudo cobraba los pesos como dólares.
                                               const aMonedaFinal = (linea) => {
                                                   const sub = parseFloat(linea.TotalLinea) || 0;
                                                   const monLinea = (linea.Moneda || pc.Moneda || '').toUpperCase();
                                                   if (finalMonId === 2 && monLinea === 'UYU') return sub / cotizacionVal;
                                                   if (finalMonId === 1 && monLinea === 'USD') return sub * cotizacionVal;
                                                   return sub;
                                               };
                                               const dOrden     = lineasDeLaOrden[0] || null;
                                               let cantOrden  = lineasDeLaOrden.some(d => d.Cantidad   != null)
                                                   ? lineasDeLaOrden.reduce((s, d) => s + (parseFloat(d.Cantidad) || 0), 0)
                                                   : (parseFloat(ordenDeposito.magnitud ?? oRow.Magnitud) || totalMetros || 0);
                                               let costoOrden = esRepoCliente ? 0 : (lineasDeLaOrden.some(d => d.TotalLinea != null)
                                                   ? Math.round(lineasDeLaOrden.reduce((s, d) => s + aMonedaFinal(d), 0) * 100) / 100
                                                   : currentMonto);
                                               let prodOrden  = (dOrden && dOrden.IDProdReact)        ? dOrden.IDProdReact           : (ordenDeposito.proIdProducto ?? oRow.ProIdProducto ?? null);
                                               // [POR ÁREA] La PRO madre de un pedido cobrado por área entra a Depósito con el
                                               // TOTAL del pedido (sus líneas propias solo tienen el artículo o $0), la cantidad
                                               // de prendas y su producto — mismo helper que los otros ingresos y la etiqueta.
                                               if (!esRepoCliente && ordenDeposito.ordenId) {
                                                   const dep = await importeOrdenParaDeposito(poolLocal, ordenDeposito.ordenId, finalMonId === 2 ? 'USD' : 'UYU');
                                                   if (dep?.porArea) {
                                                       if (parseFloat(dep.Imp) > 0) costoOrden = Math.round(parseFloat(dep.Imp) * 100) / 100;
                                                       if (parseFloat(dep.Cant) > 0) cantOrden = parseFloat(dep.Cant);
                                                       if (dep.Prod) prodOrden = dep.Prod;
                                                   }
                                               }
                                               // Prioriza la madre (si se redirigió) y resuelve por CodCliente si el id no vino.
                                               const cliPKForDep = await resolverCliPK(poolLocal, ordenDeposito.cliIdCliente || oRow.CliIdCliente, ordenDeposito.codCliente || oRow.CodCliente);
                                               if (!cliPKForDep) {
                                                   logger.error(`[DEPOSITO] ${ordenDeposito.codigoOrden}: el cliente no existe — NO se crea el registro de depósito. ¿Cliente eliminado?`);
                                               } else {
                                               const lugarReq = await poolLocal.request().input('CID', require('mssql').Int, cliPKForDep).query("SELECT FormaEnvioID FROM Clientes WITH(NOLOCK) WHERE CliIdCliente = @CID");
                                               const lugarRetiro = lugarReq.recordset[0]?.FormaEnvioID ? parseInt(lugarReq.recordset[0].FormaEnvioID) : null;

                                               const insertResult = await poolLocal.request()
                                                   .input('Cod', require('mssql').VarChar, ordenDeposito.codigoOrden)
                                                   .input('Cant', require('mssql').Float, cantOrden)
                                                   .input('Cli', require('mssql').Int, cliPKForDep)
                                                   .input('Trab', require('mssql').VarChar, ordenDeposito.descripcionTrabajo || oRow.DescripcionTrabajo)
                                                   .input('Prod', require('mssql').Int, prodOrden)
                                                   .input('Mon', require('mssql').Int, finalMonId)
                                                   .input('Costo', require('mssql').Float, costoOrden)
                                                   .input('Usr', require('mssql').Int, usuarioId || 1)
                                                   .input('Lugar', require('mssql').Int, lugarRetiro)
                                                   .query(`
                                                       INSERT INTO OrdenesDeposito (
                                                           OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo,
                                                           MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal,
                                                           OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual, LReIdLugarRetiro
                                                       )
                                                       OUTPUT INSERTED.OrdIdOrden
                                                       VALUES (
                                                           @Cod, @Cant, @Cli, @Trab, 1, @Prod, @Mon, @Costo,
                                                           GETDATE(), @Usr, 1, GETDATE(), @Lugar
                                                       )
                                                   `);
                                               if (insertResult.recordset[0]?.OrdIdOrden) {
                                                   await poolLocal.request()
                                                       .input('OID', require('mssql').Int, insertResult.recordset[0].OrdIdOrden)
                                                       .input('Usr', require('mssql').Int, usuarioId || 1)
                                                       .query("INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@OID, 1, GETDATE(), @Usr)");
                                               }
                                               console.log(`[WMS-INTERNAL] Creado OrdenesDeposito para ${ordenDeposito.codigoOrden}${ordenDeposito.codigoOrden !== oRow.CodigoOrden ? ` (redirigido desde hermana ${oRow.CodigoOrden})` : ''}`);
                                               }  // fin else cliente resuelto
                                               }
                                           }
                                           // ------------------------------------------------------------------------------------------------
                                         
                                           // Líneas de cobranza de ESTA orden, no del pedido completo: en un pedido
                                           // multitela hay 1 línea por tela y N órdenes hermanas; recorrer todas las
                                           // líneas para cada hermana descontaba los metros de cada plan N veces
                                           // (y sumaba el importe del pedido entero en cada orden).
                                           // Fallback al comportamiento previo SOLO si ninguna línea trae OrdenID
                                           // (pedidos legacy sin desglose): ahí el pedido es de una sola orden.
                                           // Las líneas "Incluido en PRO" (EsHermanaConsolidada) no se cobran aparte: ya
                                           // están dentro del subtotal de la línea de la madre PRO. Antes no hacía falta
                                           // filtrarlas porque la madre marcaba el pedido y las hermanas no se asentaban.
                                           const lineasPedido = details.recordset;
                                           const lineasOrden  = lineasPedido.filter(d => Number(d.OrdenID) === Number(L_OrdenID) && !Number(d.EsHermanaConsolidada));
                                           const lineasContab = esMadrePorArea
                                               ? lineasPedido.filter(d => !Number(d.EsHermanaConsolidada))   // [POR ÁREA] todo el pedido
                                               : lineasOrden.length > 0
                                               ? lineasOrden
                                               : (lineasPedido.some(d => d.OrdenID != null) ? [] : lineasPedido);
                                           console.log(`${logPrefix} -> Líneas a contabilizar: ${lineasContab.length} de ${lineasPedido.length} del pedido`);

                                           let importeTotalOrden = 0;
                                           for (const d of lineasContab) {
                                               const lineQty = parseFloat(d.Cantidad) || 0;
                                               const lineMon = (d.Moneda || pc.Moneda || 'UYU').trim().toUpperCase();
                                               const docMon = (pc.Moneda || 'UYU').trim().toUpperCase();
                                               let lineImp = parseFloat(d.TotalLinea) || 0;

                                               if (lineMon !== docMon) {
                                                   if (lineMon === 'UYU' && docMon === 'USD') {
                                                       lineImp = parseFloat((lineImp / cotizacionVal).toFixed(2));
                                                   } else if (lineMon === 'USD' && docMon === 'UYU') {
                                                       lineImp = parseFloat((lineImp * cotizacionVal).toFixed(2));
                                                   }
                                               }

                                               // Línea cotizada en $0 por PREPAGO al crear la orden (perfil "Prepago...").
                                               // Si al INGRESAR el plan ya no cubre (no-rollo), esos metros se cobran al
                                               // precio de LISTA original guardado en la línea — si no, salen gratis.
                                               const esLineaPrepagoCero = (parseFloat(d.PrecioUnitario) || 0) === 0
                                                   && String(d.PerfilAplicado || '').startsWith('Prepago');
                                               const puOrigLinea = parseFloat(d.PrecioUnitarioOriginal) || 0;
                                               const aDocMon = (imp, monDe) => {
                                                   const m = (monDe || docMon).trim().toUpperCase();
                                                   if (m === 'UYU' && docMon === 'USD') return parseFloat((imp / cotizacionVal).toFixed(2));
                                                   if (m === 'USD' && docMon === 'UYU') return parseFloat((imp * cotizacionVal).toFixed(2));
                                                   return parseFloat(imp.toFixed(2));
                                               };

                                              // Detectar si el cliente tiene un plan activo y cuántos metros disponibles
                                              // (cliPKReal resuelto arriba; con null el plan no matchea y no se asienta nada)
                                              const cliPK = cliPKReal;
                                              let planMetrosDisp = 0;
                                              let planIdCtb = null;
                                              if (d.IDProdReact) {
                                                  const planQueryCtb = await poolLocal.request()
                                                      .input('Cli', require('mssql').Int, cliPK)
                                                      .input('Pro', require('mssql').Int, d.IDProdReact)
                                                      .query(`SELECT TOP 1 pm.PlaIdPlan,
                                                                   ISNULL(pm.PlaCantidadTotal, 0) - ISNULL(pm.PlaCantidadUsada, 0) AS MetrosDisponibles
                                                               FROM dbo.PlanesMetros pm WITH(NOLOCK)
                                                               WHERE pm.CliIdCliente = @Cli 
                                                                 AND pm.PlaActivo = 1
                                                                 AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                                                                 AND (
                                                                   pm.ProIdProducto = @Pro
                                                                   OR EXISTS (
                                                                     SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                                                                     WHERE pap.PlaIdPlan = pm.PlaIdPlan
                                                                       AND pap.ProIdProducto = @Pro
                                                                   )
                                                                 )
                                                               ORDER BY pm.PlaFechaVencimiento ASC`);
                                                  if (planQueryCtb.recordset.length > 0) {
                                                      planMetrosDisp = parseFloat(planQueryCtb.recordset[0].MetrosDisponibles) || 0;
                                                      planIdCtb = planQueryCtb.recordset[0].PlaIdPlan;
                                                  }
                                              }

                                              const hayPlanCtb = planIdCtb !== null && planMetrosDisp > 0;

                                              // ROLLO/SEMANAL: con plan activo (aunque esté en 0 o negativo) la línea entra
                                              // ENTERA como ENTREGA a $0 — el hook deja el plan en rojo y la próxima
                                              // recarga lo absorbe. Nunca genera deuda en dinero por el producto.
                                              if ((esClienteRollo && planIdCtb !== null) || (hayPlanCtb && lineQty <= planMetrosDisp)) {
                                                  // CASO A: Plan cubre todo — 1 evento ENTREGA a $0
                                                  console.log(`${logPrefix} -> ENTREGA TOTAL por prepago (${lineQty}m, $0, Plan #${planIdCtb}${esClienteRollo ? ', rollo: puede quedar en negativo' : ''})`);
                                                  await contabilidadService.procesarEventoContable('ENTREGA', {
                                                      OrdIdOrden: L_OrdenID,
                                                      CliIdCliente: cliPK,
                                                      ProIdProducto: d.IDProdReact || null,
                                                      Cantidad: lineQty,
                                                      Importe: 0,
                                                      CodigoOrden: oRow.CodigoOrden,
                                                      NombreTrabajo: oRow.DescripcionTrabajo,
                                                      UsuarioAlta: usuarioId || 1,
                                                      MonIdMoneda: finalMonId
                                                  });

                                              } else if (hayPlanCtb && planMetrosDisp > 0 && lineQty > planMetrosDisp) {
                                                  // CASO B: Plan cubre PARCIALMENTE — 2 eventos
                                                  const metrosRestCtb = lineQty - planMetrosDisp;
                                                  const proporcionCtb = lineQty > 0 ? metrosRestCtb / lineQty : 1;
                                                  let importeExcedente = parseFloat((lineImp * proporcionCtb).toFixed(2));
                                                  // Línea $0 por prepago al crear, pero HOY el plan no cubre estos
                                                  // metros: el excedente se cobra a precio de lista original.
                                                  if (importeExcedente === 0 && esLineaPrepagoCero && puOrigLinea > 0) {
                                                      importeExcedente = aDocMon(metrosRestCtb * puOrigLinea, d.MonedaOriginal || lineMon);
                                                      console.log(`${logPrefix} -> Línea $0 por prepago sin cobertura HOY: excedente ${metrosRestCtb}m x lista ${puOrigLinea} = ${importeExcedente}`);
                                                  }

                                                  console.log(`${logPrefix} -> ENTREGA PARCIAL por prepago: ${planMetrosDisp}m a $0 + ${metrosRestCtb}m a $${importeExcedente} (Plan #${planIdCtb})`);

                                                  // Evento 1: ENTREGA por los metros cubiertos
                                                  await contabilidadService.procesarEventoContable('ENTREGA', {
                                                      OrdIdOrden: L_OrdenID,
                                                      CliIdCliente: cliPK,
                                                      ProIdProducto: d.IDProdReact || null,
                                                      Cantidad: planMetrosDisp,
                                                      Importe: 0,
                                                      CodigoOrden: oRow.CodigoOrden,
                                                      NombreTrabajo: `[PREPAGO] ${oRow.DescripcionTrabajo}`,
                                                      UsuarioAlta: usuarioId || 1,
                                                      MonIdMoneda: finalMonId
                                                  });

                                                  // Evento 2: ORDEN por el excedente (Agrupado)
                                                  if (importeExcedente > 0 || metrosRestCtb > 0) {
                                                      importeTotalOrden += importeExcedente;
                                                  }

                                              } else if (lineImp > 0) {
                                                  // CASO C: Sin plan — evento ORDEN normal (Agrupado)
                                                  importeTotalOrden += lineImp;
                                              } else if (!esClienteRollo && esLineaPrepagoCero && puOrigLinea > 0 && lineQty > 0) {
                                                  // CASO C-bis: línea $0 por prepago al crear, pero HOY no hay plan
                                                  // que la cubra (no-rollo): se cobra entera a precio de lista original.
                                                  const impLista = aDocMon(lineQty * puOrigLinea, d.MonedaOriginal || lineMon);
                                                  console.log(`${logPrefix} -> Línea $0 por prepago SIN plan al ingresar: cobra ${lineQty}m x lista ${puOrigLinea} = ${impLista}`);
                                                  importeTotalOrden += impLista;
                                              }
                                          }

                                          // Llamada única al motor contable por el TOTAL agrupado de la orden
                                          if (importeTotalOrden > 0 && cliPKReal) {
                                              const cliPK = cliPKReal;
                                              console.log(`${logPrefix} -> ORDEN agrupada sin prepago ($${importeTotalOrden})`);
                                              await contabilidadService.procesarEventoContable('ORDEN', {
                                                  OrdIdOrden: L_OrdenID,
                                                  CliIdCliente: cliPK,
                                                  ProIdProducto: null,
                                                  Cantidad: 1,
                                                  CodigoOrden: oRow.CodigoOrden,
                                                  NombreTrabajo: oRow.DescripcionTrabajo,
                                                  UsuarioAlta: usuarioId || 1,
                                                  Importe: importeTotalOrden,
                                                  MonIdMoneda: finalMonId
                                              });
                                          }


                                        // RE-COTIZACIÓN AL INGRESAR: el costo cobrable de la orden pasa a ser lo
                                        // que realmente quedó en DINERO tras aplicar la cobertura del plan/rollo
                                        // de HOY (0 si quedó toda cubierta; el excedente si fue parcial; la lista
                                        // original si venía en $0 y ya no hay cobertura). Así el retiro y la caja
                                        // cobran lo mismo que asentó la contabilidad — ni de más ni de menos.
                                        // Solo si la orden aún no tiene retiro ni pago (nunca pisa cobros hechos).
                                        if (lineasContab.length > 0) {
                                            try {
                                                const costoReal = Math.round((importeTotalOrden + Number.EPSILON) * 100) / 100;
                                                const stampRes = await poolLocal.request()
                                                    .input('Costo', require('mssql').Float, costoReal)
                                                    .input('OID', require('mssql').Int, L_OrdenID)
                                                    .query(`
                                                        UPDATE od SET od.OrdCostoFinal = @Costo
                                                        FROM dbo.OrdenesDeposito od
                                                        WHERE od.OrdCodigoOrden = (SELECT CodigoOrden FROM dbo.Ordenes WITH(NOLOCK) WHERE OrdenID = @OID)
                                                          AND od.PagIdPago IS NULL
                                                          AND od.OReIdOrdenRetiro IS NULL
                                                          AND ABS(ISNULL(od.OrdCostoFinal, 0) - @Costo) > 0.005;
                                                        SELECT @@ROWCOUNT AS n;`);
                                                if ((stampRes.recordset[0]?.n || 0) > 0) {
                                                    await poolLocal.request()
                                                        .input('Costo', require('mssql').Float, costoReal)
                                                        .input('OID', require('mssql').Int, L_OrdenID)
                                                        .query('UPDATE dbo.Ordenes SET CostoTotal = @Costo WHERE OrdenID = @OID');
                                                    console.log(`${logPrefix} -> Costo re-estampado al ingresar: ${costoReal} (cobertura real de hoy)`);
                                                }
                                            } catch (eStamp) {
                                                logger.error(`[DEPOSITO] ${oRow.CodigoOrden}: error re-estampando costo al ingresar: ${eStamp.message}`);
                                            }
                                        }

                                        // Marca del pedido: "ya pasó por el ingreso". Las hermanas de esta misma
                                        // pasada se asientan igual (pedidosAsentadosEnEstaPasada).
                                        await poolLocal.request()
                                            .input('M', require('mssql').Decimal(18,2), currentMonto)
                                            .input('Met', require('mssql').Decimal(18,2), totalMetros)
                                            .input('PID', require('mssql').Int, pc.ID)
                                            .query("UPDATE PedidosCobranza SET MontoContabilizado = @M, MetrosContabilizados = @Met WHERE ID = @PID");
                                        pedidosAsentadosEnEstaPasada.add(pc.ID);
                                     }  // fin if (asentar)
                                 }  // fin if (pcReq)

                                 // Fallback: órdenes de reposición (-R1, -R2...) u órdenes sin PedidosCobranza
                                 // no entran al bloque contable, pero igual deben insertarse en OrdenesDeposito
                                 // para que el aviso funcione.
                                 try {
                                     // Las fallas (-F) son internas: tampoco deben crear registro por el fallback
                                     const esFallaFb = (oRow.CodigoOrden || '').includes('-F');
                                     // Ídem hermanas de terminaciones (XEUV): no tienen línea propia de
                                     // cobranza — justamente por eso caen SIEMPRE en este fallback — y
                                     // entrarían al depósito como una orden fantasma de costo 0.
                                     const esTerminacFb = (oRow.AreaID || '').trim().toUpperCase() === 'TERMINAC';
                                     // [PRENDAS] Hermana de una prenda comprada+personalizada: redirigir a la
                                     // madre PRO en vez de simplemente omitir (ver resolverOrdenParaDeposito).
                                     const ordenDepositoFb = (esFallaFb || esTerminacFb)
                                         ? null
                                         : await resolverOrdenParaDeposito(poolLocal, L_OrdenID, oRow.CodigoOrden);

                                     if (ordenDepositoFb) {
                                         const fallbackCheck = await poolLocal.request()
                                             .input('Cod', require('mssql').VarChar, ordenDepositoFb.codigoOrden)
                                             .query("SELECT OrdIdOrden FROM OrdenesDeposito WITH(NOLOCK) WHERE OrdCodigoOrden = @Cod");

                                         if (fallbackCheck.recordset.length === 0) {
                                         const cliPKFb = await resolverCliPK(poolLocal, ordenDepositoFb.cliIdCliente || oRow.CliIdCliente, ordenDepositoFb.codCliente || oRow.CodCliente);
                                         if (!cliPKFb) {
                                             console.error(`[WMS-FALLBACK] ${ordenDepositoFb.codigoOrden}: el cliente no existe — NO se crea el registro de depósito. ¿Cliente eliminado?`);
                                         } else {
                                         const lugarFbReq = await poolLocal.request()
                                             .input('CID', require('mssql').Int, cliPKFb)
                                             .query("SELECT FormaEnvioID FROM Clientes WITH(NOLOCK) WHERE CliIdCliente = @CID");
                                         const lugarFb = lugarFbReq.recordset[0]?.FormaEnvioID ? parseInt(lugarFbReq.recordset[0].FormaEnvioID) : null;

                                         // Importe/cantidad/producto de la línea de ESTA orden (o de la madre, si
                                         // se redirigió) — no 0 fijo: cubre hermanas cuyo pedido ya quedó
                                         // contabilizado (marca) en esta misma pasada.
                                         const fbMoneda = (pcReq.recordset[0]?.Moneda === 'USD') ? 'USD' : 'UYU';
                                         // [POR ÁREA] la PRO madre de un pedido por área entra con el total del pedido
                                         const linFb = await importeOrdenParaDeposito(poolLocal, ordenDepositoFb.ordenId, fbMoneda);
                                         const fbCant  = parseFloat(linFb.Cant) || ordenDepositoFb.magnitud || oRow.Magnitud || 0;
                                         const fbCosto = Math.round((parseFloat(linFb.Imp) || 0) * 100) / 100;
                                         const fbProd  = linFb.Prod || ordenDepositoFb.proIdProducto || oRow.ProIdProducto || null;
                                         const fbMon   = (fbMoneda === 'USD') ? 2 : 1;

                                         const fbInsert = await poolLocal.request()
                                             .input('Cod', require('mssql').VarChar, ordenDepositoFb.codigoOrden)
                                             .input('Cli', require('mssql').Int, cliPKFb)
                                             .input('Trab', require('mssql').VarChar, ordenDepositoFb.descripcionTrabajo || oRow.DescripcionTrabajo)
                                             .input('Prod', require('mssql').Int, fbProd)
                                             .input('Cant', require('mssql').Float, fbCant)
                                             .input('Mon', require('mssql').Int, fbMon)
                                             .input('Costo', require('mssql').Float, fbCosto)
                                             .input('Usr', require('mssql').Int, usuarioId || 1)
                                             .input('Lugar', require('mssql').Int, lugarFb)
                                             .query(`
                                                 INSERT INTO OrdenesDeposito (
                                                     OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo,
                                                     MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal,
                                                     OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual, LReIdLugarRetiro
                                                 )
                                                 OUTPUT INSERTED.OrdIdOrden
                                                 VALUES (
                                                     @Cod, @Cant, @Cli, @Trab, 1, @Prod, @Mon, @Costo,
                                                     GETDATE(), @Usr, 1, GETDATE(), @Lugar
                                                 )
                                             `);
                                         if (fbInsert.recordset[0]?.OrdIdOrden) {
                                             await poolLocal.request()
                                                 .input('OID', require('mssql').Int, fbInsert.recordset[0].OrdIdOrden)
                                                 .input('Usr', require('mssql').Int, usuarioId || 1)
                                                 .query("INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@OID, 1, GETDATE(), @Usr)");
                                             console.log(`[WMS-FALLBACK] Creado OrdenesDeposito para repo/sin-PC: ${ordenDepositoFb.codigoOrden}${ordenDepositoFb.codigoOrden !== oRow.CodigoOrden ? ` (redirigido desde hermana ${oRow.CodigoOrden})` : ''}`);
                                         }
                                         }  // fin else cliente resuelto
                                         }
                                     }
                                 } catch (eFb) {
                                     console.error(`[WMS-FALLBACK] Error insertando OrdenesDeposito fallback para ${oRow.CodigoOrden}:`, eFb.message);
                                 }
                             }  // fin for items
                } catch (eCont) {
                    console.error("[CONTABILIDAD-WMS] Error al procesar evento en DEPOSITO:", eCont);
                    throw eCont;
                }

                // --- REWORK: escribir contadores (números del PEDIDO) y estado 13 (Esperando) o 1 (Ingresado).
                // Si la fila no existe y el pedido está incompleto (flujo manual, sin createOrden),
                // se CREA en estado 13 con el importe/cantidad/producto de la línea de la orden,
                // para que quede visible en la bandeja "Esperando Bultos". ---
                try {
                    const poolCnt = await getPool();
                    for (const oid of ordenesProcesar) {
                        const bInfo = ordenBultos[oid];
                        if (!bInfo) continue;

                        const oInf = await poolCnt.request()
                            .input('OID', require('mssql').Int, oid)
                            .query(`SELECT CodigoOrden, CliIdCliente, CodCliente, DescripcionTrabajo, ProIdProducto,
                                           TRY_CAST(Magnitud AS FLOAT) AS Magnitud,
                                           LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) AS NoDoc
                                    FROM Ordenes WITH(NOLOCK) WHERE OrdenID=@OID`);
                        const oi = oInf.recordset[0];
                        // Las fallas (-F) son internas: no gestionan fila propia en depósito.
                        // [PRENDAS] Hermana de una prenda comprada+personalizada: los contadores
                        // (Esperados/Recibidos, YA calculados a nivel PEDIDO más arriba) se
                        // actualizan sobre la fila de la madre PRO, no sobre una fila propia de
                        // la hermana (que nunca existe — ver resolverOrdenParaDeposito).
                        const esFallaUp = (oi?.CodigoOrden || '').includes('-F');
                        const ordenDepositoUp = (oi && !esFallaUp)
                            ? await resolverOrdenParaDeposito(poolCnt, oid, oi.CodigoOrden)
                            : null;
                        if (!ordenDepositoUp) continue;

                        const upd = await poolCnt.request()
                            .input('Cod', require('mssql').VarChar, ordenDepositoUp.codigoOrden)
                            .input('Esp', require('mssql').Int, bInfo.esperados)
                            .input('Rec', require('mssql').Int, bInfo.recibidos)
                            .input('Est', require('mssql').Int, bInfo.lista ? 1 : 13)
                            .query(`
                                UPDATE OrdenesDeposito
                                SET BultosEsperados=@Esp, BultosRecibidos=@Rec,
                                    OrdEstadoActual=@Est, OrdFechaEstadoActual=GETDATE()
                                WHERE OrdCodigoOrden = @Cod
                                  -- Solo gestiona órdenes recién entrando (1) o esperando (13).
                                  -- No toca las ya avisadas/en retiro/entregadas/canceladas/perdidas.
                                  AND OrdEstadoActual NOT IN (6,7,9,10,11,12)
                            `);

                        // UPSERT: sin fila y pedido incompleto → crearla en estado 13 (visibilidad en bandeja)
                        if (!bInfo.lista && (upd.rowsAffected?.[0] || 0) === 0) {
                                const existe = await poolCnt.request()
                                    .input('Cod', require('mssql').VarChar, ordenDepositoUp.codigoOrden)
                                    .query(`SELECT TOP 1 OrdIdOrden FROM OrdenesDeposito WITH(NOLOCK) WHERE OrdCodigoOrden = @Cod`);
                                if (existe.recordset.length === 0) {
                                    // La moneda del pedido va PRIMERO: es la que decide a qué moneda
                                    // convertir cada línea antes de sumarlas.
                                    const monR = await poolCnt.request()
                                        .input('ND', require('mssql').VarChar, oi.NoDoc || '')
                                        .query(`SELECT TOP 1 Moneda FROM PedidosCobranza WITH(NOLOCK) WHERE LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) = @ND`);
                                    const upMoneda = (monR.recordset[0]?.Moneda === 'USD') ? 'USD' : 'UYU';
                                    // [POR ÁREA] la PRO madre de un pedido por área entra con el total del pedido
                                    const lin = await importeOrdenParaDeposito(poolCnt, ordenDepositoUp.ordenId, upMoneda);
                                    const cliPkUp = await resolverCliPK(poolCnt, ordenDepositoUp.cliIdCliente || oi.CliIdCliente, ordenDepositoUp.codCliente || oi.CodCliente);
                                    if (!cliPkUp) {
                                        console.error(`[REWORK-BULTOS] ${ordenDepositoUp.codigoOrden}: el cliente no existe — no se crea la fila en Esperando. ¿Cliente eliminado?`);
                                        continue;
                                    }
                                    const lugR = await poolCnt.request()
                                        .input('CID', require('mssql').Int, cliPkUp)
                                        .query("SELECT FormaEnvioID FROM Clientes WITH(NOLOCK) WHERE CliIdCliente=@CID");
                                    const insUp = await poolCnt.request()
                                        .input('Cod', require('mssql').VarChar, ordenDepositoUp.codigoOrden)
                                        .input('Cant', require('mssql').Float, parseFloat(lin.Cant) || ordenDepositoUp.magnitud || oi.Magnitud || 0)
                                        .input('Cli', require('mssql').Int, cliPkUp)
                                        .input('Trab', require('mssql').VarChar, ordenDepositoUp.descripcionTrabajo || oi.DescripcionTrabajo)
                                        .input('Prod', require('mssql').Int, lin.Prod || ordenDepositoUp.proIdProducto || oi.ProIdProducto || null)
                                        .input('Mon', require('mssql').Int, (upMoneda === 'USD') ? 2 : 1)
                                        .input('Costo', require('mssql').Float, Math.round((parseFloat(lin.Imp) || 0) * 100) / 100)
                                        .input('Usr', require('mssql').Int, usuarioId || 1)
                                        .input('Lugar', require('mssql').Int, lugR.recordset[0]?.FormaEnvioID ? parseInt(lugR.recordset[0].FormaEnvioID) : null)
                                        .input('Esp', require('mssql').Int, bInfo.esperados)
                                        .input('Rec', require('mssql').Int, bInfo.recibidos)
                                        .query(`
                                            INSERT INTO OrdenesDeposito (
                                                OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo,
                                                MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal,
                                                OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual,
                                                LReIdLugarRetiro, BultosEsperados, BultosRecibidos
                                            )
                                            OUTPUT INSERTED.OrdIdOrden
                                            VALUES (@Cod, @Cant, @Cli, @Trab, 1, @Prod, @Mon, @Costo,
                                                    GETDATE(), @Usr, 13, GETDATE(), @Lugar, @Esp, @Rec)
                                        `);
                                    if (insUp.recordset[0]?.OrdIdOrden) {
                                        await poolCnt.request()
                                            .input('OID', require('mssql').Int, insUp.recordset[0].OrdIdOrden)
                                            .input('Usr', require('mssql').Int, usuarioId || 1)
                                            .query("INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@OID, 13, GETDATE(), @Usr)");
                                    }
                                    console.log(`[REWORK-BULTOS] Fila creada en Esperando (13) para ${ordenDepositoUp.codigoOrden}${ordenDepositoUp.codigoOrden !== oi.CodigoOrden ? ` (redirigido desde hermana ${oi.CodigoOrden})` : ''}`);
                                }
                        }
                    }
                } catch (eCnt) {
                    console.error("[REWORK-BULTOS] Error actualizando contadores/estado:", eCnt.message);
                }
            }
            for (const oid of ordenesProcesar) {
                if (ordenBultos[oid] && !ordenBultos[oid].lista) continue;  // pedido incompleto: no pasa a Ingresado hasta tener todos los bultos
                if (expandidas.has(Number(oid))) {
                    // Hermana sumada al completarse el pedido: no regredir si ya avanzó (avisada/retiro/entregada)
                    const chkE = await new sql.Request(transaction)
                        .input('OID', sql.Int, oid)
                        .query(`SELECT TOP 1 OrdEstadoActual FROM OrdenesDeposito WITH(NOLOCK)
                                WHERE OrdCodigoOrden = (SELECT TOP 1 CodigoOrden FROM Ordenes WITH(NOLOCK) WHERE OrdenID=@OID)
                                ORDER BY OrdIdOrden DESC`);
                    const estE = chkE.recordset[0]?.OrdEstadoActual;
                    if (estE && [6, 7, 9, 10, 11, 12].includes(Number(estE))) continue;
                }
                await changeOrderState(transaction, {
                    target   : { type: 'ORDER', id: oid },
                    estado   : 'Ingresado',
                    userObj  : req.user || req.body.usuario || usuarioId || 'Sistema',
                    detalle  : `Orden Ingresada (Recepción en ${areaReceptora})`,
                    io       : req.app.get('socketio')
                });
            }

            await transaction.commit();

            // [PRENDAS] FASE 6: el remito final PRO→DEPOSITO YA NO se arma solo acá al recibir
            // en PRO (eso vivía en la Fase 5 — se sacó por un bug real: "En Tránsito" contaba
            // como "pronto" en isPedidoCompletoGlobal, así que un componente que todavía viajaba
            // HACIA PRO ya se contaba como listo, y el sistema armaba remitos parciales de a
            // uno). Ahora es una acción manual desde la pantalla de Control de PRO — ver
            // getPedidosCompletosPRO / aprobarControlPRO más abajo, que usan
            // isPedidoCompletoFisicamenteEnArea (mira la UBICACIÓN real del bulto, no el estado
            // de la orden).
            res.json({ success: true, status: newStatus });

        }         catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        if (err.statusCode && err.statusCode < 500) logger.warn(`Rechazado receiveDispatch: ${err.message}`);
        else logger.error("Error receiveDispatch:", err);
        res.status(err.statusCode || 500).json({ error: err.message });
    }
};

// [PRENDAS] FASE 6 — Control manual en PRO: en vez de armar el remito final PRO→DEPOSITO
// solo (Fase 5, sacado por el bug de "En Tránsito" ya visto arriba), el dueño revisa el
// pedido reunido en PRO y lo aprueba a mano. isPedidoCompletoFisicamenteEnArea (mira la
// UBICACIÓN real del bulto, no el estado de la orden) es la fuente de verdad de ambos
// endpoints — mismo criterio, sin duplicar lógica.
exports.getPedidosCompletosPRO = async (req, res) => {
    try {
        const pool = await getPool();
        const { isPedidoCompletoFisicamenteEnArea } = require('../services/pedidoCompletoService');

        // Candidatos: pedidos con orden madre PRO real que ya tienen algún componente
        // físicamente en PRO — evita recorrer TODA la tabla Ordenes.
        const candidatosRes = await pool.request().query(`
            -- [VENTA UNA LÍNEA] El pedido se identifica por su NoDocERP o, para la venta de
            -- retiro de un artículo que llega directo a PRO, por ComboPedidoNoDocERP.
            SELECT DISTINCT X.NoDocERP FROM (
                SELECT LTRIM(RTRIM(CASE WHEN O.EstadoDependencia = 'VENTA_DIRECTA' THEN O.ComboPedidoNoDocERP
                                        ELSE CAST(O.NoDocERP AS VARCHAR(50)) END)) AS NoDocERP
                FROM Ordenes O
                JOIN Logistica_Bultos B ON B.OrdenID = O.OrdenID
                WHERE (O.AreaID <> 'PRO' OR (O.EstadoDependencia = 'VENTA_DIRECTA' AND O.ComboPedidoNoDocERP IS NOT NULL))
                  AND B.UbicacionActual = 'PRO' AND B.Estado = 'EN_STOCK'
                  AND ISNULL(B.Tipocontenido, '') <> 'ENCOMIENDA'
            ) X
            WHERE X.NoDocERP IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM Ordenes P
                  WHERE LTRIM(RTRIM(P.NoDocERP)) = X.NoDocERP AND P.AreaID = 'PRO'
                    AND ISNULL(P.EstadoDependencia, '') <> 'VENTA_DIRECTA'
              )
        `);

        const pedidos = [];
        for (const row of candidatosRes.recordset) {
            const chk = await isPedidoCompletoFisicamenteEnArea(pool, row.NoDocERP, 'PRO');
            // [PRENDAS] Bandeja PRO: antes se ocultaba el pedido hasta que TODOS sus
            // componentes llegaran — sin poder verlo mientras tanto. Ahora se muestra igual,
            // marcado 'esperando' (con lo que falta), y pasa a 'recibido' cuando ya está
            // completo. `ControlPedidosPRO.jsx` (pantalla vieja) sigue mostrando solo los
            // 'recibido' filtrando del lado del cliente — mismo comportamiento de siempre ahí.
            const estado = chk.completo ? 'recibido' : 'esperando';

            const ordenProRes = await pool.request()
                .input('Doc', sql.VarChar, row.NoDocERP)
                .query(`
                    SELECT TOP 1 O.OrdenID, O.DescripcionTrabajo, O.CodigoOrden,
                           O.Magnitud AS CantidadPrendas,
                           A.Descripcion AS NombreProducto,
                           -- O.Cliente es texto suelto cargado al crear la orden — en pedidos del
                           -- portal a veces queda el USUARIO (ej. 'Yoa1973') en vez del nombre real
                           -- del cliente. Clientes.Nombre (vía CliIdCliente, la FK real) es la
                           -- fuente confiable; O.Cliente queda solo de último recurso.
                           ISNULL(NULLIF(LTRIM(RTRIM(C.Nombre)), ''), O.Cliente) AS ClienteNombre
                    FROM Ordenes O
                    LEFT JOIN Articulos A ON A.ProIdProducto = O.ProIdProducto
                    LEFT JOIN Clientes C ON C.CliIdCliente = O.CliIdCliente
                    WHERE O.NoDocERP = @Doc AND O.AreaID = 'PRO'
                      AND ISNULL(O.EstadoDependencia, '') <> 'VENTA_DIRECTA'
                    ORDER BY O.OrdenID
                `);
            const ordenPro = ordenProRes.recordset[0];
            if (!ordenPro) continue; // no debería pasar — por seguridad

            // [VENTA x ITEM] "Comprar y personalizar" crea UNA PRO POR ARTÍCULO del carrito:
            // la cantidad del pedido no es la de "la" PRO (TOP 1 agarraba una cualquiera), es
            // la suma de todas. Con una sola PRO da lo mismo que antes.
            const prosRes = await pool.request()
                .input('Doc', sql.VarChar, row.NoDocERP)
                .query(`
                    SELECT COUNT(*) AS Articulos, SUM(ISNULL(TRY_CAST(Magnitud AS FLOAT), 0)) AS Total
                    FROM Ordenes
                    WHERE NoDocERP = @Doc AND AreaID = 'PRO' AND ISNULL(EstadoDependencia, '') <> 'VENTA_DIRECTA'
                `);
            const articulosPro = prosRes.recordset[0]?.Articulos || 1;
            const cantidadPrendasPedido = articulosPro > 1 ? prosRes.recordset[0].Total : ordenPro.CantidadPrendas;

            // DISTINCT sobre O.OrdenID: un componente (Bordado, Estampado...) puede tener
            // varios bultos propios en PRO (tandas/remitos parciales de la misma orden) — sin
            // esto el JOIN a Logistica_Bultos hacía fan-out y el mismo componente aparecía
            // repetido tantas veces como bultos tuviera, todos mostrando la Magnitud total.
            const componentesRes = await pool.request()
                .input('Doc', sql.VarChar, row.NoDocERP)
                .query(`
                    SELECT DISTINCT O.OrdenID, O.CodigoOrden, O.AreaID, O.Magnitud, O.ComboItemID,
                           A.Descripcion AS NombreArticulo
                    FROM Ordenes O
                    JOIN Logistica_Bultos B ON B.OrdenID = O.OrdenID
                        AND B.UbicacionActual = 'PRO' AND B.Estado = 'EN_STOCK'
                        AND ISNULL(B.Tipocontenido, '') <> 'ENCOMIENDA'
                    LEFT JOIN Articulos A ON A.ProIdProducto = O.ProIdProducto
                    WHERE (O.NoDocERP = @Doc AND O.AreaID <> 'PRO')
                       -- [VENTA UNA LÍNEA] artículo sin personalizar que llegó directo a PRO
                       OR (LTRIM(RTRIM(O.ComboPedidoNoDocERP)) = LTRIM(RTRIM(@Doc)) AND O.EstadoDependencia = 'VENTA_DIRECTA')
                    ORDER BY O.OrdenID
                `);

            // Spec 39: "físicamente reunido en PRO" (bultos en la ubicación) no es lo mismo
            // que "completo según el libro de entregas" — puede haber una reposición abierta
            // en una etapa anterior de la cadena (ej. una falla de Sublimación) que nunca pasa
            // por PRO. Se muestra igual (no se oculta el pedido) pero con el motivo, mismo
            // criterio que "Lo que falta de este pedido" en las demás bandejas.
            const incompletas = await libroEntregas.ordenesIncompletasPedido(row.NoDocERP, pool);
            // Magnitud EFECTIVA para las áreas de bandeja (Bordado/Estampado/Corte/Costura):
            // Ordenes.Magnitud suele quedar en '0' ahí, las piezas reales viven en
            // ArchivosOrden/ArchivosReferencia (mismo cálculo que usa esa bandeja al aprobar).
            const AREAS_BANDEJA = new Set(['EMB', 'EST', 'TWC', 'TWT']);
            let getMagnitudEfectiva = null;
            if (componentesRes.recordset.some(c => AREAS_BANDEJA.has(String(c.AreaID || '').trim().toUpperCase()))) {
                try { ({ getMagnitudEfectiva } = require('./embBoardController')); } catch (eReq) { /* best effort */ }
            }
            const magnitudesEfectivas = {};
            for (const c of componentesRes.recordset) {
                if (getMagnitudEfectiva && AREAS_BANDEJA.has(String(c.AreaID || '').trim().toUpperCase())) {
                    try { magnitudesEfectivas[c.OrdenID] = await getMagnitudEfectiva(pool, c.OrdenID); } catch (eMag) { /* deja el crudo */ }
                }
            }
            pedidos.push({
                noDocERP: row.NoDocERP,
                ordenProId: ordenPro.OrdenID,
                codigoOrden: ordenPro.CodigoOrden,
                cliente: ordenPro.ClienteNombre,
                trabajo: ordenPro.DescripcionTrabajo,
                producto: ordenPro.NombreProducto,
                // La cantidad de prendas del PEDIDO es la Magnitud de la orden madre PRO
                // (UM='u', el "campo prendas" real) — la fuente única y confiable. La
                // Magnitud de cada componente NO sirve para esto: Sublimación/DTF/TPU miden
                // metros de tela, no prendas, y comparar esos números entre sí no dice nada.
                cantidadPrendas: cantidadPrendasPedido,
                // Cuántos artículos (PRO) tiene el pedido: >1 = varias prendas distintas, cada
                // una con su propia cantidad (no se comparan entre sí).
                articulosPedido: articulosPro,
                estado,
                totalComponentes: chk.totalOrdenes,
                componentes: componentesRes.recordset.map(c => ({
                    ordenId: c.OrdenID,
                    codigoOrden: c.CodigoOrden,
                    areaId: c.AreaID,
                    nombreArticulo: c.NombreArticulo,
                    // Prenda a la que pertenece (combo o artículo del carrito). Las cantidades
                    // solo se comparan entre componentes de la MISMA prenda.
                    comboItemId: c.ComboItemID,
                    magnitud: magnitudesEfectivas[c.OrdenID] != null ? magnitudesEfectivas[c.OrdenID] : c.Magnitud,
                    // true solo en las áreas de bandeja (EMB/EST/TWC/TWT): ahí la magnitud
                    // efectiva SÍ está contada en piezas/prendas (getMagnitudEfectiva). En el
                    // resto (Sublimación, DTF, TPU...) la Magnitud es otra unidad (metros) —
                    // no es comparable contra "cantidad de prendas" y no debe mostrarse como tal.
                    esPrendas: AREAS_BANDEJA.has(String(c.AreaID || '').trim().toUpperCase()),
                })),
                faltantesPorLlegar: chk.faltantes.map(f => ({ codigoOrden: String(f.CodigoOrden).trim(), areaId: f.AreaID, estadoenArea: f.EstadoenArea })),
                libroIncompleto: incompletas.length > 0,
                motivosLibro: incompletas.map(i => ({ codigoOrden: String(i.CodigoOrden).trim(), areaId: i.AreaID, motivos: i.motivos })),
            });
        }

        res.json({ success: true, pedidos });
    } catch (err) {
        logger.error('[PRENDAS] getPedidosCompletosPRO:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.aprobarControlPRO = async (req, res) => {
    const noDocERP = (req.params.noDocERP || '').trim();
    if (!noDocERP) return res.status(400).json({ error: 'noDocERP inválido.' });
    try {
        const pool = await getPool();
        const { isPedidoCompletoFisicamenteEnArea } = require('../services/pedidoCompletoService');

        // Re-verificación: evita doble-click o que 2 operadores aprueben el mismo pedido a
        // la vez / que llegue un componente nuevo entre que se abrió la pantalla y se aprobó.
        const chk = await isPedidoCompletoFisicamenteEnArea(pool, noDocERP, 'PRO');
        if (!chk.completo) {
            return res.status(400).json({ error: `Todavía falta${chk.faltantes.length === 1 ? '' : 'n'} ${chk.faltantes.length} componente(s) por llegar a PRO.` });
        }
        // [ACCESORIOS] Requisito de la orden madre: los accesorios de stock (mástil, base…) tienen que
        // estar recibidos en PRO (bulto EN_STOCK acá). Mismo control que el ingreso a Depósito.
        try { await validarAccesoriosRecibidos(pool, [{ NoDocERP: noDocERP }]); }
        catch (eAcc) { return res.status(400).json({ error: eAcc.message }); }

        // Spec 39: "reunido físicamente en PRO" no es lo mismo que "completo según el libro"
        // (puede haber una reposición abierta en una etapa anterior que nunca pasa por PRO).
        // Se corta ACÁ, antes de generar la etiqueta final y consumir los bultos de los
        // componentes — evita dejar el pedido a medio consolidar cuando el remito final
        // (createRemito, más abajo) lo iba a rechazar de todos modos.
        const incompletas = await libroEntregas.ordenesIncompletasPedido(noDocERP, pool);
        if (incompletas.length > 0) {
            const detalle = incompletas.map(i => `${String(i.CodigoOrden).trim()} (${i.motivos.join('; ') || 'incompleta'})`).join(' · ');
            return res.status(400).json({ error: `El pedido ${noDocERP} no está completo según el libro de entregas: ${detalle}. No se puede consolidar en PRO hasta que no quede ninguna reposición ni envío parcial abierto.` });
        }

        const ordenProRes = await pool.request()
            .input('Doc', sql.VarChar, noDocERP)
            .query(`
                SELECT TOP 1 OrdenID FROM Ordenes
                WHERE NoDocERP = @Doc AND AreaID = 'PRO' AND ISNULL(EstadoDependencia, '') <> 'VENTA_DIRECTA'
            `);
        const ordenProId = ordenProRes.recordset[0]?.OrdenID;
        if (!ordenProId) return res.status(404).json({ error: 'No se encontró la orden madre PRO de este pedido.' });

        // Bultos de los componentes que se van a consumir (cerrar) tras generar el bulto final.
        const bultosComponentes = await pool.request()
            .input('Doc', sql.VarChar, noDocERP)
            .query(`
                SELECT B.BultoID
                FROM Ordenes O
                JOIN Logistica_Bultos B ON B.OrdenID = O.OrdenID
                WHERE ((O.NoDocERP = @Doc AND O.AreaID <> 'PRO')
                       -- [VENTA UNA LÍNEA] el bulto del artículo sin personalizar también se consume
                       OR (LTRIM(RTRIM(O.ComboPedidoNoDocERP)) = LTRIM(RTRIM(@Doc)) AND O.EstadoDependencia = 'VENTA_DIRECTA'))
                  AND B.UbicacionActual = 'PRO' AND B.Estado = 'EN_STOCK'
                  AND ISNULL(B.Tipocontenido, '') <> 'ENCOMIENDA'
            `);

        // Bulto FINAL (producto terminado consolidado) sobre la orden madre — su
        // ProximoServicio ya es 'DEPOSITO', sale PROD_TERMINADO sin overrides.
        const LabelGenerationService = require('../services/LabelGenerationService');
        const lr = await LabelGenerationService.addOneBulto(ordenProId, req.user?.id || 1, req.user?.usuario || 'Sistema', {});
        if (!lr.success) {
            return res.status(500).json({ error: `No se pudo generar la etiqueta final: ${lr.error}` });
        }

        // Consumir (cerrar) los bultos de los componentes — ya cumplieron su función, mismo
        // patrón que el AUTO-CONSUME de createRemito (líneas ~536-583 de este archivo).
        for (const b of bultosComponentes.recordset) {
            await pool.request()
                .input('BID', sql.Int, b.BultoID)
                .query(`UPDATE Logistica_Bultos SET Estado = 'PROCESADO', UbicacionActual = 'PROCESADO' WHERE BultoID = @BID`);
        }

        // Remito final PRO→DEPOSITO con el bulto nuevo — reusa createRemitoFromOrders tal
        // cual (mismo patrón de req/res simulados que el remito automático de la Fase 4).
        let remitoResult = null;
        const fakeRes = {
            json: (data) => { remitoResult = data; },
            status: (code) => ({ json: (data) => { remitoResult = { ...data, _statusCode: code }; } }),
        };
        await exports.createRemitoFromOrders({
            body: {
                areaOrigen: 'PRO',
                areaDestino: 'DEPOSITO',
                usuarioId: req.user?.id || 1,
                orderIds: [ordenProId],
                observations: `Control aprobado — pedido completo (${noDocERP})`,
            },
            user: req.user || 'Sistema',
            app: req.app,
        }, fakeRes);

        if (!remitoResult?.success) {
            logger.warn(`[PRENDAS] aprobarControlPRO: etiqueta generada pero el remito falló para ${noDocERP}:`, remitoResult);
            return res.json({
                success: true,
                totalBultos: lr.totalBultos,
                remitoCreado: false,
                message: 'Etiqueta generada, pero el remito no se pudo armar automáticamente — armalo a mano desde Despacho de PRO.',
            });
        }

        res.json({
            success: true,
            totalBultos: lr.totalBultos,
            remitoCreado: true,
            dispatchCode: remitoResult.dispatchCode,
            componentesConsumidos: bultosComponentes.recordset.length,
        });
    } catch (err) {
        logger.error('[PRENDAS] aprobarControlPRO:', err);
        res.status(500).json({ error: err.message });
    }
};

// --- BANDEJA: órdenes esperando bultos (estado 13) ---
// Los contadores se calculan EN VIVO con la misma regla que la recepción (bultosPedidoService):
// los guardados en OrdenesDeposito son de la última recepción y no se enteran de un bulto
// declarado perdido, de una reposición nueva ni de una etiqueta borrada. Si ya no falta nada,
// la fila sale como Completo y el botón de la bandeja la ingresa por el camino normal.
exports.getEsperandoBultos = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT od.OrdIdOrden, od.OrdCodigoOrden,
                   od.CliIdCliente, c.Nombre AS Cliente,
                   ISNULL(od.BultosEsperados, 0) AS BultosEsperados,
                   ISNULL(od.BultosRecibidos, 0) AS BultosRecibidos,
                   od.OrdNombreTrabajo,
                   od.OrdFechaEstadoActual,
                   DATEDIFF(DAY, od.OrdFechaEstadoActual, GETDATE()) AS DiasEsperando,
                   o.OrdenID AS OrdenIdReal,
                   NULLIF(LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))), '') AS NoDoc
            FROM OrdenesDeposito od WITH(NOLOCK)
            LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = od.CliIdCliente
            LEFT JOIN Ordenes o WITH(NOLOCK) ON LTRIM(RTRIM(o.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden))
            WHERE od.OrdEstadoActual = 13
            ORDER BY od.OrdFechaEstadoActual ASC
        `);
        const filas = r.recordset;
        const conteo = await bultosPedido.contarBultos(pool, {
            noDocs: filas.map(f => f.NoDoc).filter(Boolean),
            ordenIds: filas.filter(f => !f.NoDoc && f.OrdenIdReal).map(f => f.OrdenIdReal),
            conFaltantes: true,
        });
        res.json(filas.map(f => {
            const c = f.NoDoc ? conteo.get(`P:${f.NoDoc}`) : (f.OrdenIdReal ? conteo.get(`O:${Number(f.OrdenIdReal)}`) : null);
            // Sin orden en el sistema (no se puede contar): quedan los números de la última recepción
            if (!c) return { ...f, Completo: false, Faltantes: [] };
            return {
                ...f,
                BultosEsperados: c.esperados,
                BultosRecibidos: c.recibidos,
                Completo: c.recibidos >= c.esperados,
                Faltantes: c.faltantes,
            };
        }));
    } catch (err) {
        logger.error("Error getEsperandoBultos:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getDashboard = async (req, res) => {
    const { areaId } = req.query;
    try {
        const pool = await getPool();

        // Ejecutar ambas queries EN PARALELO para reducir tiempo de respuesta
        const [r, rPending] = await Promise.all([
            // 1. Bultos existentes en el área
            pool.request().input('A', sql.VarChar, areaId)
                .query(`
                    SELECT 
                        b.BultoID, b.CodigoEtiqueta, b.Descripcion, b.Estado, b.UbicacionActual, b.Tipocontenido,
                        b.OrdenID,
                        o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.ProximoServicio,
                        (SELECT COUNT(*) FROM Logistica_Bultos WITH(NOLOCK)
                          WHERE OrdenID = b.OrdenID
                            AND ISNULL(Tipocontenido,'') <> 'ENCOMIENDA') as TotalBultosOrden
                    FROM Logistica_Bultos b WITH(NOLOCK)
                    -- Encomiendas: OrdenID = N° de OrdenesRetiro, no de Ordenes (evita colgar
                    -- el bulto de una orden nueva que nació con ese mismo número)
                    LEFT JOIN Ordenes o WITH(NOLOCK) ON b.OrdenID = o.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
                    WHERE b.UbicacionActual = @A 
                    AND b.Estado NOT IN ('PERDIDO', 'DESPACHADO', 'EN_TRANSITO')
                `),

            // 2. Órdenes pendientes sin bultos aún
            // OPTIMIZACIÓN: NOT EXISTS en lugar de LEFT JOIN — mucho más eficiente con índices
            pool.request().input('A', sql.VarChar, areaId)
                .query(`
                    SELECT
                        o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Estado, o.AreaID, o.EstadoLogistica
                    FROM Ordenes o WITH(NOLOCK)
                    WHERE o.AreaID = @A
                    AND o.Estado NOT IN ('Entregado', 'Finalizado', 'Cancelado', 'Pendiente')
                    AND NOT EXISTS (
                        -- OJO: en bultos de ENCOMIENDA el OrdenID es el N° de OrdenesRetiro,
                        -- NO de Ordenes — sin este filtro una encomienda ajena con el mismo
                        -- número "tapa" a la orden y desaparece del canasto.
                        SELECT 1 FROM Logistica_Bultos lb WITH(NOLOCK)
                        WHERE lb.OrdenID = o.OrdenID
                          AND ISNULL(lb.Tipocontenido, '') <> 'ENCOMIENDA'
                    )
                `)
        ]);

        // Estructuras de retorno
        const fallas = [];
        const incompletos = [];
        const completos = {}; // { 'NOMBRE_CANASTO': [Orders...] }

        // Agrupar bultos por Orden
        const ordersMap = {};

        // A. Procesar Bultos Reales (Asumimos que si tiene bultos, ya está "Listo" o en "Stock")
        // Pero respetamos si la orden tiene una marca específica de logística

        // ... (Lógica de bultos permanece igual, pero podemos enriquecerla con EstadoLogistica si hiciéramos JOIN en query 1) ...
        // Para consistencia, vamos a actualizar query 1 también si es necesario, pero por ahora nos enfocamos en el mappeo.

        for (const row of r.recordset) {
            const oid = row.OrdenID || 'S/O-' + row.CodigoEtiqueta;
            if (!ordersMap[oid]) {
                ordersMap[oid] = {
                    id: row.OrdenID,
                    code: row.CodigoOrden || 'S/O',
                    client: row.Cliente || 'Sin Cliente',
                    desc: row.DescripcionTrabajo || row.Descripcion,
                    area: areaId,
                    status: 'PRONTO', // Bulto físico implica 'PRONTO' usualmente
                    logStatus: 'LISTO', // Por defecto
                    bultos: []
                };
            }

            ordersMap[oid].bultos.push({
                id: row.BultoID,
                code: row.CodigoEtiqueta,
                status: row.Estado,
                desc: row.Descripcion,
                tipoBulto: row.Tipocontenido || 'PROD_TERMINADO',
                proximoServicio: row.ProximoServicio,
                num: ordersMap[oid].bultos.length + 1,
                total: row.TotalBultosOrden || 1
            });
        }

        // B. Procesar Ordenes Pendientes
        for (const row of rPending.recordset) {
            const oid = row.OrdenID;
            if (!ordersMap[oid]) {
                ordersMap[oid] = {
                    id: row.OrdenID,
                    code: row.CodigoOrden || `ORD-${row.OrdenID}`,
                    client: row.Cliente || 'Sin Cliente',
                    desc: row.DescripcionTrabajo,
                    area: areaId,
                    status: row.Estado || 'EN PROCESO',
                    logStatus: row.EstadoLogistica, // <--- CAMPO CLAVE
                    bultos: []
                };
            }
            // Bulto Virtual
            ordersMap[oid].bultos.push({
                id: null,
                isVirtual: true,
                code: 'PENDIENTE',
                status: 'VIRTUAL',
                desc: 'Bulto Virtual',
                num: 1,
                total: 1
            });
        }

        // Clasificar Ordenes usando EstadoLogistica
        Object.values(ordersMap).forEach(ord => {
            // Prioridad 1: Bultos con Falla
            const hasFailBulto = ord.bultos.some(b => b.status === 'RETENIDO' || b.status === 'FALLA');
            // Prioridad 2: EstadoLogistica Explicito
            const logSt = (ord.logStatus || '').toUpperCase();

            // MATCH EXACTO CON VALORES DE PRODUCCION (productionFileController)
            // Valores esperados: 'Canasto Incompletos', 'Esperando Reposición', 'Canasto Produccion', 'Canasto Reposiciones'

            if (hasFailBulto || logSt.includes('REPOSICION') || logSt.includes('FALLA')) {
                fallas.push(ord);
            }
            else if (logSt.includes('INCOMPLETO')) {
                incompletos.push(ord);
            }
            else {
                // Canastos Dinámicos
                let basketName = ord.logStatus; // Mantener casing original si existe

                if (!basketName) {
                    // Si es NULL, inferimos por existencia de bultos físicos
                    const hasPhysical = ord.bultos.some(b => !b.isVirtual);
                    basketName = hasPhysical ? `Listo en ${areaId}` : `En Proceso (${areaId})`;
                } else {
                    // Normalizar 'Canasto Produccion' a 'Listo en X' para consistencia visual
                    if (basketName.toUpperCase() === 'CANASTO PRODUCCION') {
                        basketName = `Listo en ${areaId}`;
                    }
                }

                if (!completos[basketName]) completos[basketName] = [];
                completos[basketName].push(ord);
            }
        });

        res.json({
            fallas,
            incompletos,
            completos
        });

    } catch (err) {
        logger.error("Error getDashboard:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getHistory = async (req, res) => {
    // Implementation similar to legacy but querying Logistica_Bultos or MovimientosLogistica
    // Keeping it simple for now
    const { areaId } = req.query;
    try {
        const pool = await getPool();
        const r = await pool.request().input('A', sql.VarChar, areaId)
            .query("SELECT TOP 50 * FROM MovimientosLogistica WHERE AreaID = @A ORDER BY FechaMovimiento DESC");
        res.json(r.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 3. TRANSPORT / CADETE
// ==========================================

exports.confirmTransport = async (req, res) => {
    const { remitoCode, scannedCodes, driverName, driverDetails, userId } = req.body;

    try {
        const pool = await getPool();

        // 1. Operator Check
        const uid = userId || 1;

        // 2. Remito Check
        const remitoRes = await pool.request()
            .input('C', sql.VarChar, remitoCode)
            .query("SELECT EnvioID, Estado, AreaOrigenID, AreaDestinoID FROM Logistica_Envios WHERE CodigoRemito = @C");

        if (remitoRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Remito no encontrado' });
        }
        const envio = remitoRes.recordset[0];

        // GUARD: si el destino ya recibió el remito, firmar la salida lo pisaba a
        // EN_TRANSITO y el remito "resucitaba" en la bandeja de check-in con todos
        // los bultos en verde (caso REM-333997 / REM-113666). RECIBIDO_PARCIAL sí
        // se permite: puede haber un segundo viaje con los bultos que faltaron.
        if (envio.Estado === 'RECIBIDO_TOTAL' || envio.Estado === 'ENTREGADO') {
            return res.status(409).json({
                error: `El remito ${remitoCode} ya fue recibido completo en ${envio.AreaDestinoID}. No se puede firmar una salida de un remito ya recibido.`
            });
        }

        // 3. Check Total Items vs Scanned
        const totalItemsReq = await pool.request()
            .input('EID', sql.Int, envio.EnvioID)
            .query("SELECT COUNT(*) as Total FROM Logistica_EnvioItems WHERE EnvioID = @EID");
        const totalItems = totalItemsReq.recordset[0].Total;
        const scannedCount = scannedCodes.length;

        const isPartial = scannedCount < totalItems;
        const newState = isPartial ? 'EN_TRANSITO_PARCIAL' : 'EN_TRANSITO';

        // 4. Update Transaction
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const obsText = driverDetails ? `${driverName} (${driverDetails})` : driverName;

            // Log Movements for each scanned item
            for (const code of scannedCodes) {
                // Update Movement Log
                await new sql.Request(transaction)
                    .input('Cod', sql.VarChar, code)
                    .input('Tipo', sql.VarChar, 'TRANSITO_INICIO')
                    .input('Area', sql.VarChar, 'TRANSITO')
                    .input('UID', sql.Int, uid)
                    .input('Obs', sql.NVarChar, `Salida con: ${obsText} - Remito: ${remitoCode}`)
                    .query(`
                        INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones) 
                        VALUES (@Cod, @Tipo, @Area, @UID, @Obs)
                    `);
            }

            // Update Logistica_Envios: Observaciones + Estado
            // If partial, maybe we should mark which items were NOT dispatched?
            // For now, tracking at Remito level is sufficient as per request "EN QUE ESTADO QUEDA".
            let finalObs = `Transportista: ${obsText}`;
            if (isPartial) finalObs += ` | PARCIAL (${scannedCount}/${totalItems})`;

            await new sql.Request(transaction)
                .input('Obs', sql.NVarChar, finalObs)
                .input('Est', sql.VarChar, newState)
                .input('EID', sql.Int, envio.EnvioID)
                .query("UPDATE Logistica_Envios SET Observaciones = ISNULL(Observaciones, '') + ' | ' + @Obs, Estado = @Est WHERE EnvioID = @EID");

            await transaction.commit();

            res.json({
                success: true,
                message: isPartial
                    ? `Despacho PARCIAL confirmado (${scannedCount}/${totalItems}). Estado: ${newState}`
                    : `Despacho COMPLETO confirmado. Estado: ${newState}`
            });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (err) {
        logger.error("Error confirmTransport:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.confirmRemitoDelivery = async (req, res) => {
    try {
        const { code } = req.params;
        const file = req.file;
        let { bultosIds } = req.body;
        
        if (!bultosIds) {
            return res.status(400).json({ error: 'Debe especificar los bultos a los que aplica este comprobante' });
        }

        // Parse bultosIds from FormData text
        let idsArray = [];
        try {
            idsArray = typeof bultosIds === 'string' ? JSON.parse(bultosIds) : bultosIds;
        } catch (e) {
            return res.status(400).json({ error: 'Formato inválido de bultosIds' });
        }

        if (idsArray.length === 0) {
            return res.status(400).json({ error: 'No se seleccionaron bultos' });
        }

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        try {
            // Ensure column exists in BULTOS instead of Envios (Safe to fail if already exists)
            try {
                await new sql.Request(transaction).query("ALTER TABLE Logistica_Bultos ADD ComprobantePath NVARCHAR(MAX) NULL");
            } catch (e) { /* Ignore */ }

            const comprobanteUrl = file ? `/comprobantesEncomiendas/${file.filename}` : null;
            const idsList = idsArray.join(',');

            // 1. Update Bultos inside this Envio
            await new sql.Request(transaction)
                .input('Path', sql.NVarChar, comprobanteUrl)
                .query(`
                    UPDATE Logistica_Bultos
                    SET Estado = 'ENTREGADO', UbicacionActual = 'CLIENTE_FINAL', 
                    ComprobantePath = ISNULL(@Path, ComprobantePath)
                    WHERE BultoID IN (${idsList})
                `);
                
            // 1.5 Update items in the Envio
            await new sql.Request(transaction)
                .input('Code', sql.VarChar, code)
                .query(`
                    UPDATE Logistica_EnvioItems
                    SET EstadoRecepcion = 'ENTREGADO'
                    WHERE BultoID IN (${idsList}) AND EnvioID = (SELECT EnvioID FROM Logistica_Envios WHERE CodigoRemito = @Code)
                `);

            // 2. Update OrdenesRetiro to Mark as Entregado (state 5) if they were encomiendas
            await new sql.Request(transaction).query(`
                UPDATE OrdenesRetiro
                SET OReEstadoActual = 5, OReFechaEstadoActual = GETDATE()
                WHERE OReIdOrdenRetiro IN (
                    SELECT b.OrdenID FROM Logistica_Bultos b
                    WHERE b.BultoID IN (${idsList}) AND b.Tipocontenido = 'ENCOMIENDA' AND b.OrdenID IS NOT NULL
                );

                UPDATE OrdenesDeposito
                SET OrdEstadoActual = 9, OrdFechaEstadoActual = GETDATE()
                WHERE OReIdOrdenRetiro IN (
                    SELECT b.OrdenID FROM Logistica_Bultos b
                    WHERE b.BultoID IN (${idsList}) AND b.Tipocontenido = 'ENCOMIENDA' AND b.OrdenID IS NOT NULL
                );
            `);

            // 3. Check if ALL items in this Envio are delivered to mark the Envio itself as Delivered
            const remainingReq = await new sql.Request(transaction)
                .input('Code', sql.VarChar, code)
                .query(`
                    SELECT COUNT(*) as Pendientes 
                    FROM Logistica_EnvioItems i
                    JOIN Logistica_Envios e ON e.EnvioID = i.EnvioID
                    WHERE e.CodigoRemito = @Code AND i.EstadoRecepcion != 'ENTREGADO'
                `);
            
            if (remainingReq.recordset[0].Pendientes === 0) {
                await new sql.Request(transaction)
                    .input('Code', sql.VarChar, code)
                    .query("UPDATE Logistica_Envios SET Estado = 'ENTREGADO' WHERE CodigoRemito = @Code");
            }

            await transaction.commit();
            res.json({ success: true, message: 'Comprobante subido y bultos cerrados exitosamente' });
        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }
    } catch (err) {
        logger.error("Error confirmRemitoDelivery:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getActiveTransports = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT TOP 200
                e.EnvioID,
                e.CodigoRemito,
                e.Estado,
                e.Observaciones,
                e.AreaOrigenID,
                e.AreaDestinoID,
                e.FechaSalida as FechaCreacion,
                e.FechaSalida as Fecha,
                (SELECT COUNT(*) FROM Logistica_EnvioItems WHERE EnvioID = e.EnvioID) as TotalBultos,
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM Logistica_EnvioItems ei
                        INNER JOIN Logistica_Bultos b ON ei.BultoID = b.BultoID
                        WHERE ei.EnvioID = e.EnvioID AND b.Tipocontenido = 'ENCOMIENDA'
                    ) THEN 'ENCOMIENDA'
                    ELSE 'PRODUCCION'
                END AS TipoEnvio
            FROM Logistica_Envios e
            ORDER BY e.FechaSalida DESC
        `);
        res.json(r.recordset);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
};

// --- REQUISITOS DE PRODUCCION (MANUAL CHECK) ---

exports.getOrderRequirements = async (req, res) => {
    const { ordenId, areaId } = req.query;
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Area', sql.VarChar, areaId)
            .query(`
                SELECT 
                    req.RequisitoID, 
                    req.CodigoRequisito, 
                    req.Descripcion, 
                    req.EsBloqueante,
                    CASE WHEN cum.Estado = 'CUMPLIDO' THEN 1 ELSE 0 END as Cumplido,
                    cum.FechaCumplimiento
                FROM ConfigRequisitosProduccion req
                LEFT JOIN OrdenCumplimientoRequisitos cum 
                    ON req.RequisitoID = cum.RequisitoID AND cum.OrdenID = @OID
                WHERE req.AreaID = @Area
            `);
        // [ACCESORIOS] El requisito ACCESORIOS de PRO solo aplica si el pedido lleva accesorios de stock
        // (anclas "RETIRO ACCESORIO"). Sin ellos se muestra cumplido como "no aplica"; con ellos, el
        // detalle dice cuántos faltan recibir en PRO.
        const filas = r.recordset;
        // [ESTAMPADO] Cada Estampado estampa UN transfer: el del DTF no espera "TPU a Estampar" y el del TPU no
        // espera "DTF a Estampar". El canal sale de la orden de la que depende (LiberaCuandoOrdenID) o de la variante.
        if (String(areaId || '').trim().toUpperCase() === 'EST') {
            try {
                const ch = await pool.request().input('OID', sql.Int, ordenId).query(`
                    SELECT o.Variante, (SELECT TOP 1 LTRIM(RTRIM(f.AreaID)) FROM Ordenes f WHERE f.OrdenID = o.LiberaCuandoOrdenID) AS FuenteAreaID
                    FROM Ordenes o WHERE o.OrdenID = @OID`);
                const src = `${ch.recordset[0]?.FuenteAreaID || ''} ${ch.recordset[0]?.Variante || ''}`.toUpperCase();
                const canal = /TPU/.test(src) ? 'TPU' : (/\bDF\b|DTF/.test(src) ? 'DTF' : null);
                if (canal) {
                    const otro = canal === 'TPU' ? 'DTF' : 'TPU';
                    filas.forEach((x, i) => {
                        if (String(x.CodigoRequisito || '').trim().toUpperCase() === otro) {
                            filas[i] = { ...x, Cumplido: 1, NoAplica: true, Observaciones: `No aplica — este Estampado es de ${canal}` };
                        }
                    });
                }
            } catch (eEst) { logger.warn('[ESTAMPADO] requisitos: ' + eEst.message); }
        }
        const iAcc = filas.findIndex(x => String(x.CodigoRequisito || '').toUpperCase() === 'ACCESORIOS');
        if (iAcc >= 0) {
            try {
                const acc = await pool.request().input('OID', sql.Int, ordenId).query(`
                    SELECT LTRIM(RTRIM(a.DescripcionTrabajo)) AS Nombre, LTRIM(RTRIM(a.NoDocERP)) AS Ven,
                           (SELECT COUNT(*) FROM Logistica_Bultos b WHERE b.OrdenID = a.OrdenID AND b.Estado = 'EN_STOCK' AND b.UbicacionActual = 'PRO') AS EnPro,
                           ISNULL(pc.EstadoCobro, '') AS EstadoCobro
                    FROM Ordenes m
                    JOIN Ordenes a ON LTRIM(RTRIM(a.ComboPedidoNoDocERP)) = LTRIM(RTRIM(m.NoDocERP))
                        AND a.AreaID = 'PRO' AND a.EstadoDependencia = 'VENTA_DIRECTA' AND a.DescripcionTrabajo LIKE 'RETIRO ACCESORIO%'
                    LEFT JOIN PedidosCobranza pc ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(a.NoDocERP))
                    WHERE m.OrdenID = @OID`);
                const lista = acc.recordset.filter(x => x.EstadoCobro !== 'CANCELADO');
                const faltan = lista.filter(x => Number(x.EnPro) === 0);
                const nom = (x) => x.Nombre.replace(/^RETIRO ACCESORIO\s*[—-]\s*/i, '');
                if (!lista.length) {
                    filas[iAcc] = { ...filas[iAcc], Cumplido: 1, NoAplica: true, Detalle: 'No aplica: el pedido no lleva accesorios de stock.' };
                } else {
                    filas[iAcc] = { ...filas[iAcc], Cumplido: faltan.length ? 0 : 1,
                        Detalle: faltan.length
                            ? `Falta recibir en PRO: ${faltan.map(x => `${nom(x)} (${x.Ven})`).join(', ')}`
                            : `Recibidos en PRO: ${lista.map(nom).join(', ')}` };
                }
            } catch (eAcc) { logger.warn('[ACCESORIOS] requisitos: ' + eAcc.message); }
        }
        res.json(filas);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.toggleRequirement = async (req, res) => {
    const { ordenId, requisitoId, cumplido } = req.body;
    try {
        const pool = await getPool();
        if (cumplido) {
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .query(`
                    DECLARE @Area NVARCHAR(50) = (SELECT AreaID FROM ConfigRequisitosProduccion WHERE RequisitoID = @RID);
                    
                    MERGE OrdenCumplimientoRequisitos AS target
                                        USING (
                                            SELECT DISTINCT req.RequisitoID, req.AreaID, dest.OrdenID
                                            FROM ConfigRequisitosProduccion req
                                            CROSS JOIN (
                                                SELECT OrdenID FROM Ordenes 
                                                WHERE 
                                                   (
                                                       (@Doc != '' AND NoDocERP = @Doc)
                                                       OR 
                                                       (@Doc = '' AND NoDocERP = (SELECT TOP 1 NoDocERP FROM Ordenes WHERE OrdenID = @OID))
                                                       OR
                                                       (@Doc = '' AND OrdenID = @OID)
                                                   )
                                                   AND AreaID = @Area 
                                                   AND Estado != 'CANCELADO'
                                            ) dest
                                            WHERE (
                                                req.CodigoRequisito LIKE @Type
                                                OR (@Type LIKE '%DISENO%' AND req.CodigoRequisito LIKE '%DTF%')
                                                OR (@Type LIKE '%DTF%' AND req.CodigoRequisito LIKE '%DISENO%')
                                                -- [COSTURA SIN CORTE] Pedido sin orden de Corte: la tela llega directo de
                                                -- Sublimación/Directa a Costura. Lo que llega es TELA, y el requisito de
                                                -- Costura es CORTES ("Piezas Cortadas"): nunca coincidían y Costura quedaba
                                                -- "esperando requisitos" para siempre (COS-26025). Sin Corte en el pedido,
                                                -- la llegada de la tela cumple ese requisito.
                                                OR (@Type LIKE '%TELA%' AND req.CodigoRequisito = 'CORTES'
                                                    AND NOT EXISTS (SELECT 1 FROM Ordenes c
                                                                    WHERE c.NoDocERP = (SELECT NoDocERP FROM Ordenes WHERE OrdenID = @OID)
                                                                      AND c.AreaID = 'TWC' AND ISNULL(c.Estado, '') NOT IN ('CANCELADO', 'Cancelado')))
                                            )
                                            AND req.AreaID = @Area
                                        ) AS source
                    ON (target.OrdenID = source.OrdenID AND target.RequisitoID = source.RequisitoID)
                    WHEN MATCHED THEN
                        UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = GETDATE()
                    WHEN NOT MATCHED THEN
                        INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento)
                        VALUES (@OID, @Area, @RID, 'CUMPLIDO', GETDATE());
                `);
        } else {
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .query("DELETE FROM OrdenCumplimientoRequisitos WHERE OrdenID = @OID AND RequisitoID = @RID");
        }
        res.json({ success: true });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.getAreaStock = async (req, res) => {
    const { areaId } = req.query;
    try {
        const pool = await getPool();

        // Spec 39: en las áreas con envío parcial habilitado no se ocultan los bultos por hermanas
        // no prontas (el operario manda lo que ya está bien); y los bultos de una orden de falla
        // con reposición registrada aparecen como COMPLEMENTO de su madre cuando tienen que viajar.
        let areasParcial = [];
        try { areasParcial = await libroEntregas.areasConParcial(pool); } catch (e) { logger.warn('[getAreaStock] AREAS_DESPACHO_PARCIAL:', e.message); }
        const sqlAreasParcial = areasParcial.length ? areasParcial.map(a => `'${a.replace(/'/g, "''")}'`).join(',') : `''`;

        let query = `
            SELECT
                b.*,
                -- Hybrid Data Fetching (Prioritize Reception/Customer Service Data)
                o.CodigoOrden,
                o.NoDocERP,
                o.AreaID AS AreaOrden,
                o.EstadoEnvio,
                rep.ReposicionID, rep.OrdenMadreID, rep.AreaProduce, rep.AreaReporta,
                CAST(CASE WHEN rep.ReposicionID IS NULL THEN 0 ELSE 1 END AS BIT) AS EsComplemento,
                madre.CodigoOrden AS CodigoOrdenMadre,
                COALESCE(r.Codigo, '') as CodigoRecepcion,
                COALESCE(r.Cliente, o.Cliente, 'CLIENTE_NOT_FOUND') as Cliente,
                cliord.IDCliente AS IDCliente,
                COALESCE(CONCAT(r.Tipo, ' - ', r.Detalle), r.Detalle, o.DescripcionTrabajo, b.Descripcion) as DescripcionTrabajo,
                COALESCE(r.FechaRecepcion, o.FechaIngreso, b.FechaCreacion) as FechaIngreso,
                COALESCE(r.ProximoServicio, o.ProximoServicio, 'LOGISTICA') as ProximoServicio
            FROM Logistica_Bultos b
            -- Encomiendas: OrdenID = N° de OrdenesRetiro, no de Ordenes (sin el filtro, los
            -- datos de la orden fantasma pisaban al COALESCE con la recepción/bulto)
            LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
            LEFT JOIN dbo.Clientes cliord WITH(NOLOCK) ON o.CliIdCliente = cliord.CliIdCliente
            -- Spec 39: reposición registrada de una orden de falla (viaja como complemento de su madre)
            LEFT JOIN Reposiciones rep ON rep.OrdenFallaID = o.OrdenID AND rep.Estado IN ('PENDIENTE','EN_PRODUCCION')
            LEFT JOIN Ordenes madre ON madre.OrdenID = rep.OrdenMadreID
            -- ROBUST JOIN: Priority to Explicit ID, Fallback to String Match
            LEFT JOIN Recepciones r ON (
                b.RecepcionID = r.RecepcionID 
                OR 
                (b.RecepcionID IS NULL AND (
                    LTRIM(RTRIM(b.CodigoEtiqueta)) = LTRIM(RTRIM(r.Codigo)) 
                    OR 
                    (LTRIM(RTRIM(b.CodigoEtiqueta)) LIKE CONCAT(LTRIM(RTRIM(r.Codigo)), '-%'))
                    OR
                    LTRIM(RTRIM(r.Codigo)) = LEFT(b.CodigoEtiqueta, LEN(b.CodigoEtiqueta) - CHARINDEX('-', REVERSE(b.CodigoEtiqueta)))
                ))
            )
            
            WHERE b.Estado = 'EN_STOCK'
            AND NOT EXISTS (
                SELECT 1 FROM Logistica_EnvioItems ei WHERE ei.BultoID = b.BultoID
            )
            -- Pedido completo en área: ocultar producto terminado de pedidos con órdenes
            -- hermanas (mismo NoDocERP, misma área) aún no prontas
            AND NOT (
                b.Tipocontenido = 'PROD_TERMINADO'
                AND o.OrdenID IS NOT NULL
                AND UPPER(LTRIM(RTRIM(ISNULL(o.AreaID,'')))) NOT IN (${sqlAreasParcial})
                AND ${sqlExistsHermanaNoPronta('o')}
            )
            -- Fallas internas (-F): sus bultos circulan por planta con etiqueta, pero una -F NUNCA se
            -- despacha sola — su material se incorpora al pedido madre. No se ofrecen en Crear Remito.
            -- (Bultos sin orden asociada, ej. recepciones, siguen apareciendo: el IS NULL los conserva.)
            -- Spec 39: EXCEPCIÓN — una orden de falla con reposición registrada sí se ofrece, como
            -- complemento de su madre, cuando nació en otra área (faltante hacia atrás) o cuando la madre
            -- ya salió en envío parcial.
            AND (o.CodigoOrden IS NULL OR o.CodigoOrden NOT LIKE '%-F%'
                 OR (rep.ReposicionID IS NOT NULL AND (UPPER(LTRIM(RTRIM(rep.AreaReporta))) <> UPPER(LTRIM(RTRIM(rep.AreaProduce))) OR ISNULL(madre.EstadoEnvio,'') = 'PARCIAL')))
        `;

        if (areaId && areaId !== 'TODOS') {
            query += " AND b.UbicacionActual = @Area";
        }

        query += " ORDER BY b.BultoID DESC";

        const reqSql = pool.request();
        if (areaId && areaId !== 'TODOS') reqSql.input('Area', sql.VarChar, areaId);

        const r = await reqSql.query(query);
        res.json(r.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- LOST & FOUND ---

// CHECK-IN TERMINAC DIFERIDO: recuperar de extraviados un bulto hacia Terminaciones
// equivale a recibir el material — la hermana XEUV 'Pendiente' del mismo pedido pasa
// a 'Material Recibido'. Sin esto, el gancho solo corría en el check-in de remitos y
// las órdenes recuperadas quedaban clavadas en Pendiente (no aparecían en la bandeja).
// Nunca con encomiendas: su OrdenID es el N° de OrdenesRetiro, no de Ordenes.
async function hookTerminacRecuperado(transaction, bultoId, req, location) {
    if ((location || '').trim().toUpperCase() !== 'TERMINAC') return;
    try {
        const bInfo = await new sql.Request(transaction)
            .input('BID', sql.Int, bultoId)
            .query("SELECT OrdenID, Tipocontenido, CodigoEtiqueta FROM Logistica_Bultos WHERE BultoID = @BID");
        const b = bInfo.recordset[0];
        if (!b?.OrdenID || (b.Tipocontenido || '').toUpperCase() === 'ENCOMIENDA') return;
        const herRes = await new sql.Request(transaction)
            .input('OID', sql.Int, b.OrdenID)
            .query(`
                SELECT H.OrdenID FROM Ordenes H
                WHERE H.AreaID = 'TERMINAC' AND H.Estado NOT IN ('Cancelado')
                  AND ISNULL(H.EstadoenArea, 'Pendiente') = 'Pendiente'
                  AND H.NoDocERP = (SELECT NoDocERP FROM Ordenes WHERE OrdenID = @OID)
            `);
        for (const her of herRes.recordset) {
            await changeOrderState(transaction, {
                target : { type: 'ORDER', id: her.OrdenID },
                estado : 'Material Recibido',
                userObj: req.user || 'Sistema',
                detalle: `Material impreso recuperado de extraviados en Terminaciones (bulto ${b.CodigoEtiqueta || bultoId})`,
                io     : req.app.get('socketio')
            });
            logger.info(`[Recuperar TERMINAC] Orden ${her.OrdenID} -> Material Recibido (bulto ${b.CodigoEtiqueta})`);
        }
    } catch (eTer) {
        logger.warn('[Recuperar TERMINAC] No se pudo actualizar la hermana de terminaciones:', eTer.message);
    }
}

exports.getLostItems = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM Logistica_Bultos WHERE Estado = 'PERDIDO'");
        res.json(r.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.recoverItem = async (req, res) => {
    const { bultoId, location } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            await new sql.Request(transaction)
                .input('Loc', sql.VarChar, location || 'RECEPCION')
                .input('BID', sql.Int, bultoId)
                .query("UPDATE Logistica_Bultos SET Estado = 'EN_STOCK', UbicacionActual = @Loc WHERE BultoID = @BID");

            await new sql.Request(transaction)
                .input('Loc', sql.VarChar, location || 'RECEPCION')
                .input('BID', sql.Int, bultoId)
                .query(`
                    INSERT INTO MovimientosLogistica(CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones)
                    SELECT CodigoEtiqueta, 'RECUPERACION', @Loc, 1, 'Recuperado de Extraviados'
                    FROM Logistica_Bultos WHERE BultoID = @BID
                `);

            await hookTerminacRecuperado(transaction, bultoId, req, location);

            await transaction.commit();
            res.json({ success: true, message: 'Item recuperado existosamente' });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Let's modify confirmTransport to update Envio Status to 'EN_TRANSITO' is a good practice.
// But for now, let's query Envios with "Transporte Confirmado" in Obs OR rely on Movimientos.

// Better: Query Logistica_Envios where Estado = 'EN_TRANSITO' (if we update it)
// Let's implicitly assume any Envio created recently that is not 'RECIBIDO' and has movements 'TRANSITO_INICIO'

// Let's update `confirmTransport` to set Estado = 'EN_TRANSITO' first? 
// It's safer. BUT user is live.
// Let's Query:
// Recent movements of type TRANSITO_INICIO grouped by Remito (via Observaciones parsing or Join).

// Actually, Logistica_Envios contains "CodigoRemito".
// Let's search unique Remitos that have items in "TRANSITO" state?
// MovimientosLogistica doesn't change Item State directly in DB (Logistica_Bultos).

// Let's use a smart query:
// Get Envios where Observaciones LIKE '%Transportista:%' AND Estado != 'RECIBIDO'

// --- REQUISITOS DE PRODUCCION (MANUAL CHECK) ---

exports.getOrderRequirements = async (req, res) => {
    const { ordenId, areaId } = req.query;
    try {
        const pool = await getPool();
        // Obtener configuración + Estado actual
        const r = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Area', sql.VarChar, areaId)
            .query(`
                SELECT 
                    req.RequisitoID, 
                    req.CodigoRequisito, 
                    req.Descripcion, 
                    req.EsBloqueante,
                    CASE WHEN cum.Estado = 'CUMPLIDO' THEN 1 ELSE 0 END as Cumplido,
                    cum.FechaCumplimiento,
                    cum.Observaciones
                FROM ConfigRequisitosProduccion req
                LEFT JOIN OrdenCumplimientoRequisitos cum 
                    ON req.RequisitoID = cum.RequisitoID AND cum.OrdenID = @OID
                WHERE req.AreaID = @Area
            `);
        // [ACCESORIOS] El requisito ACCESORIOS de PRO solo aplica si el pedido lleva accesorios de stock
        // (anclas "RETIRO ACCESORIO"). Sin ellos se muestra cumplido como "no aplica"; con ellos, el
        // detalle dice cuántos faltan recibir en PRO.
        const filas = r.recordset;
        // [ESTAMPADO] Cada Estampado estampa UN transfer: el del DTF no espera "TPU a Estampar" y el del TPU no
        // espera "DTF a Estampar". El canal sale de la orden de la que depende (LiberaCuandoOrdenID) o de la variante.
        if (String(areaId || '').trim().toUpperCase() === 'EST') {
            try {
                const ch = await pool.request().input('OID', sql.Int, ordenId).query(`
                    SELECT o.Variante, (SELECT TOP 1 LTRIM(RTRIM(f.AreaID)) FROM Ordenes f WHERE f.OrdenID = o.LiberaCuandoOrdenID) AS FuenteAreaID
                    FROM Ordenes o WHERE o.OrdenID = @OID`);
                const src = `${ch.recordset[0]?.FuenteAreaID || ''} ${ch.recordset[0]?.Variante || ''}`.toUpperCase();
                const canal = /TPU/.test(src) ? 'TPU' : (/\bDF\b|DTF/.test(src) ? 'DTF' : null);
                if (canal) {
                    const otro = canal === 'TPU' ? 'DTF' : 'TPU';
                    filas.forEach((x, i) => {
                        if (String(x.CodigoRequisito || '').trim().toUpperCase() === otro) {
                            filas[i] = { ...x, Cumplido: 1, NoAplica: true, Observaciones: `No aplica — este Estampado es de ${canal}` };
                        }
                    });
                }
            } catch (eEst) { logger.warn('[ESTAMPADO] requisitos: ' + eEst.message); }
        }
        const iAcc = filas.findIndex(x => String(x.CodigoRequisito || '').toUpperCase() === 'ACCESORIOS');
        if (iAcc >= 0) {
            try {
                const acc = await pool.request().input('OID', sql.Int, ordenId).query(`
                    SELECT LTRIM(RTRIM(a.DescripcionTrabajo)) AS Nombre, LTRIM(RTRIM(a.NoDocERP)) AS Ven,
                           (SELECT COUNT(*) FROM Logistica_Bultos b WHERE b.OrdenID = a.OrdenID AND b.Estado = 'EN_STOCK' AND b.UbicacionActual = 'PRO') AS EnPro,
                           ISNULL(pc.EstadoCobro, '') AS EstadoCobro
                    FROM Ordenes m
                    JOIN Ordenes a ON LTRIM(RTRIM(a.ComboPedidoNoDocERP)) = LTRIM(RTRIM(m.NoDocERP))
                        AND a.AreaID = 'PRO' AND a.EstadoDependencia = 'VENTA_DIRECTA' AND a.DescripcionTrabajo LIKE 'RETIRO ACCESORIO%'
                    LEFT JOIN PedidosCobranza pc ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(a.NoDocERP))
                    WHERE m.OrdenID = @OID`);
                const lista = acc.recordset.filter(x => x.EstadoCobro !== 'CANCELADO');
                const faltan = lista.filter(x => Number(x.EnPro) === 0);
                const nom = (x) => x.Nombre.replace(/^RETIRO ACCESORIO\s*[—-]\s*/i, '');
                if (!lista.length) {
                    filas[iAcc] = { ...filas[iAcc], Cumplido: 1, NoAplica: true, Detalle: 'No aplica: el pedido no lleva accesorios de stock.' };
                } else {
                    filas[iAcc] = { ...filas[iAcc], Cumplido: faltan.length ? 0 : 1,
                        Detalle: faltan.length
                            ? `Falta recibir en PRO: ${faltan.map(x => `${nom(x)} (${x.Ven})`).join(', ')}`
                            : `Recibidos en PRO: ${lista.map(nom).join(', ')}` };
                }
            } catch (eAcc) { logger.warn('[ACCESORIOS] requisitos: ' + eAcc.message); }
        }
        res.json(filas);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.toggleRequirement = async (req, res) => {
    // [FIX] La versión anterior armaba un MERGE cross-orden (aplicar a TODAS las
    // hermanas del mismo NoDocERP con un CodigoRequisito que matcheara @Type) pero
    // nunca declaraba @Doc ni @Type como inputs — cualquier click en el check de
    // Requisitos tiraba "Must declare the scalar variable @Doc" y no hacía nada.
    // Simplificado a lo que en verdad hace falta: togglear ESTA orden y ESTE
    // requisito puntual, nada más.
    // fechaCumplimiento (opcional): ISO string — para cuando la aprobación pasó ANTES
    // de que alguien la cargue acá (ej. WhatsApp de ayer a la tarde). Si no viene, GETDATE().
    const { ordenId, requisitoId, cumplido, observaciones, fechaCumplimiento } = req.body; // cumplido: bool
    try {
        const pool = await getPool();
        if (cumplido) {
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .input('Obs', sql.NVarChar, observaciones || '')
                .input('Fecha', sql.DateTime, fechaCumplimiento ? new Date(fechaCumplimiento) : new Date())
                .query(`
                    DECLARE @Area NVARCHAR(50) = (SELECT AreaID FROM ConfigRequisitosProduccion WHERE RequisitoID = @RID);
                    MERGE OrdenCumplimientoRequisitos AS target
                    USING (SELECT @RID AS RequisitoID, @Area AS AreaID) AS source
                    ON (target.OrdenID = @OID AND target.RequisitoID = source.RequisitoID)
                    WHEN MATCHED THEN
                        UPDATE SET Estado = 'CUMPLIDO', FechaCumplimiento = @Fecha, Observaciones = @Obs
                    WHEN NOT MATCHED THEN
                        INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                        VALUES (@OID, source.AreaID, source.RequisitoID, 'CUMPLIDO', @Fecha, @Obs);
                `);
        } else if (observaciones) {
            // Desmarca pero deja la observación (ej. "por qué falta") — mismo criterio
            // que ya tenía la versión vieja.
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .input('Obs', sql.NVarChar, observaciones)
                .query(`
                    DECLARE @Area NVARCHAR(50) = (SELECT AreaID FROM ConfigRequisitosProduccion WHERE RequisitoID = @RID);
                    MERGE OrdenCumplimientoRequisitos AS target
                    USING (SELECT @RID AS RequisitoID, @Area AS AreaID) AS source
                    ON (target.OrdenID = @OID AND target.RequisitoID = source.RequisitoID)
                    WHEN MATCHED THEN
                        UPDATE SET Estado = 'PENDIENTE', Observaciones = @Obs
                    WHEN NOT MATCHED THEN
                        INSERT (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                        VALUES (@OID, source.AreaID, source.RequisitoID, 'PENDIENTE', NULL, @Obs);
                `);
        } else {
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('RID', sql.Int, requisitoId)
                .query("DELETE FROM OrdenCumplimientoRequisitos WHERE OrdenID = @OID AND RequisitoID = @RID");
        }
        res.json({ success: true });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.getAvailableResources = async (req, res) => {
    const { ordenId, reqCode, areaId } = req.query;
    logger.info(`[getAvailableResources] Buscando para Orden ${ordenId}, Req: ${reqCode}, Area: ${areaId}`);

    try {
        const pool = await getPool();

        // 1. Obtener Datos de la Orden (Cliente + área + bobina ya vinculada)
        const orderRes = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query("SELECT Cliente, CliIdCliente, AreaID, BobinaTelaID FROM Ordenes WHERE OrdenID = @OID");

        if (orderRes.recordset.length === 0) return res.json([]);
        const clienteNombre = orderRes.recordset[0].Cliente || '';
        const cliIdCliente = orderRes.recordset[0].CliIdCliente || null;
        const areaOrden = (orderRes.recordset[0].AreaID || areaId || '').trim();
        const bobinaTelaId = orderRes.recordset[0].BobinaTelaID || null;
        logger.info(`[REQ] Cliente: '${clienteNombre}' (ID ${cliIdCliente}), Área: ${areaOrden}, BobinaTela: ${bobinaTelaId}`);

        let resources = [];
        let specificFound = false;

        // Campos completos de la bobina de tela cliente: la etiqueta muestra tela,
        // PRE del ingreso, metros, ancho y peso — no solo "Bobina N".
        const CAMPOS_BOBINA = `
            ib.BobinaID as id,
            CASE WHEN ib.CodigoEtiqueta IS NULL THEN 'Bob-' + CAST(ib.BobinaID as varchar) ELSE ib.CodigoEtiqueta END as label,
            'Bobina ' + CAST(ib.BobinaID as varchar) + ' (' + CAST(ib.MetrosRestantes as varchar) + 'm) - ' + ISNULL(ib.Referencia, '') as description,
            ib.Ubicacion as location,
            ib.Referencia as pre,
            LTRIM(RTRIM(ISNULL(ib.DescripcionTela, ''))) as tela,
            ib.MetrosRestantes as metros,
            ib.MetrosIniciales as metrosIniciales,
            ISNULL(ib.AnchoReal, ib.Ancho) as ancho,
            ISNULL(ib.PesoReal, ib.Peso) as peso,
            ib.AreaID as areaBobina,
            ib.Estado as estadoBobina,
            ISNULL(NULLIF(LTRIM(RTRIM(ib.NombreCliente)), ''), LTRIM(RTRIM(ISNULL(cli.Nombre, '')))) as clienteBobina,
            CASE WHEN TRY_CAST(ib.ClienteID AS INT) = @CliId OR ib.OrdenID = @OID OR ib.BobinaID = @BobTela THEN 1 ELSE 0 END as esDelCliente,
            CASE WHEN ib.BobinaID = @BobTela THEN 1 ELSE 0 END as vinculadaAOrden
        `;
        const JOIN_CLIENTE = `LEFT JOIN Clientes cli ON TRY_CAST(ib.ClienteID AS INT) = cli.CliIdCliente`;

        // Lógica según tipo de requisito
        if (reqCode && reqCode.includes('TELA')) {
            // ESTRATEGIA 1: bobinas DE ESTE CLIENTE (por CliIdCliente, por la orden, o por
            // el nombre en la Referencia — legacy), en CUALQUIER estado — una tela
            // Agotada por el consumo de esta misma orden sigue siendo LA tela del
            // trabajo y tiene que verse (con su estado). La vinculada a la orden
            // (Ordenes.BobinaTelaID, la eligió el form de corte) va primera SIEMPRE.
            const queryBob = `
                    SELECT ${CAMPOS_BOBINA}
                    FROM InventarioBobinas ib
                    ${JOIN_CLIENTE}
                    WHERE ib.InsumoID = 1146 -- Filtro Solicitado
                    AND (
                         ib.BobinaID = @BobTela
                         OR (ib.Estado IN ('Disponible', 'En Uso', 'Agotado') AND (
                             ib.OrdenID = @OID
                             OR TRY_CAST(ib.ClienteID AS INT) = @CliId
                             OR ib.Referencia LIKE '%' + @CliName + '%'
                         ))
                    )
                    ORDER BY CASE WHEN ib.BobinaID = @BobTela THEN 0 ELSE 1 END,
                             CASE WHEN LTRIM(RTRIM(ISNULL(ib.AreaID, ''))) = @AreaOrden THEN 0 ELSE 1 END,
                             ib.FechaIngreso DESC
            `;
            const rSpecific = await pool.request()
                .input('CliName', sql.NVarChar, clienteNombre || 'XXXXXXXX')
                .input('OID', sql.Int, ordenId)
                .input('CliId', sql.Int, cliIdCliente)
                .input('AreaOrden', sql.VarChar(20), areaOrden)
                .input('BobTela', sql.Int, bobinaTelaId)
                .query(queryBob);

            resources = rSpecific.recordset;

            if (resources.length > 0) specificFound = true;

            // ESTRATEGIA 2: Fallback — SOLO bobinas disponibles del ÁREA de la orden
            // (antes traía las de cualquier cliente y cualquier área, y confundía).
            if (resources.length === 0) {
                logger.info(`[REQ] Sin bobinas del cliente. Trayendo disponibles del área ${areaOrden} (Insumo 1146).`);
                const rFallback = await pool.request()
                    .input('OID', sql.Int, ordenId)
                    .input('CliId', sql.Int, cliIdCliente)
                    .input('AreaOrden', sql.VarChar(20), areaOrden)
                    .input('BobTela', sql.Int, bobinaTelaId)
                    .query(`
                        SELECT TOP 50 ${CAMPOS_BOBINA}
                        FROM InventarioBobinas ib
                        ${JOIN_CLIENTE}
                        WHERE ib.Estado IN ('Disponible')
                        AND ib.InsumoID = 1146 -- Filtro Solicitado
                        AND LTRIM(RTRIM(ISNULL(ib.AreaID, ''))) = @AreaOrden
                        ORDER BY ib.FechaIngreso DESC
                    `);
                resources = rFallback.recordset;
            }
        }
        else if (reqCode && (reqCode.includes('PRENDA') || reqCode.includes('CORTES'))) {
            // Buscar Bultos Específicos
            const rSpecific = await pool.request()
                .input('OID', sql.Int, ordenId)
                .query(`
                    SELECT 
                        BultoID as id, 
                        CodigoEtiqueta as label, 
                        Descripcion + ' (' + Estado + ')' as description, 
                        UbicacionActual as location
                    FROM Logistica_Bultos
                    WHERE OrdenID = @OID
                    AND Estado IN ('EN_STOCK', 'EN_TRANSITO')
                `);
            resources = rSpecific.recordset;
            if (resources.length > 0) specificFound = true;

            // Fallback Bultos - FILTRADO POR AREA
            if (resources.length === 0) {
                let locationFilter = null;
                if (areaId === 'EMB') locationFilter = 'BORDADO';
                if (areaId === 'EST') locationFilter = 'ESTAMPADO';
                if (areaId === 'TWT') locationFilter = 'COSTURA'; // Asunción
                if (areaId === 'TWC') locationFilter = 'CORTE';

                let queryFallback = `
                        SELECT TOP 50
                            BultoID as id, 
                            CodigoEtiqueta as label, 
                            Descripcion + ' (' + Estado + ')' as description, 
                            UbicacionActual as location
                        FROM Logistica_Bultos
                        WHERE Estado IN ('EN_STOCK')
                 `;

                if (locationFilter) {
                    queryFallback += ` AND UbicacionActual = @LocFilter`;
                }

                queryFallback += ` ORDER BY BultoID DESC`;

                const reqFallback = pool.request();
                if (locationFilter) reqFallback.input('LocFilter', sql.VarChar, locationFilter);

                const rFallback = await reqFallback.query(queryFallback);
                resources = rFallback.recordset;
            }
        }

        logger.info(`[REQ] Returning ${resources.length} resources (Specific: ${specificFound})`);
        res.json(resources);

    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
};

// Duplicate getAreaStock removed. Main implementation is above.

// --- LOST & FOUND ---

exports.getLostItems = async (req, res) => {
    try {
        const pool = await getPool();
        // Fetch items with state 'PERDIDO'
        // Also fetch last update time if possible (assume Fecha is in Logs?)
        // For simplicity, just get from Bultos table
        const r = await pool.request().query("SELECT * FROM Logistica_Bultos WHERE Estado = 'PERDIDO'");
        res.json(r.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.recoverItem = async (req, res) => {
    const { bultoId, location } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Update Bulto
            await new sql.Request(transaction)
                .input('Loc', sql.VarChar, location || 'RECEPCION')
                .input('BID', sql.Int, bultoId)
                .query("UPDATE Logistica_Bultos SET Estado = 'EN_STOCK', UbicacionActual = @Loc WHERE BultoID = @BID");

            // 2. Log Movement
            await new sql.Request(transaction)
                .input('Loc', sql.VarChar, location || 'RECEPCION')
                .input('BID', sql.Int, bultoId)
                .query(`
                    INSERT INTO MovimientosLogistica(CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones)
                    SELECT CodigoEtiqueta, 'RECUPERACION', @Loc, 1, 'Recuperado de Extraviados'
                    FROM Logistica_Bultos WHERE BultoID = @BID
            `);

            // 3. Destino TERMINAC: habilitar la hermana XEUV (check-in diferido)
            await hookTerminacRecuperado(transaction, bultoId, req, location);

            await transaction.commit();
            res.json({ success: true, message: 'Item recuperado existosamente' });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- STOCK DEPOSITO Y SYNC ---

exports.getDepositStock = async (req, res) => {
    try {
        const pool = await getPool();
        // Agrupar por Pedido Base (CodigoQR string V3)
        // La logica: Bultos en DEPOSITO y EN_STOCK
        // Usamos el CodigoQR de la etiqueta para agrupar, ya que es el identificador unico del "Pedido V3"
        const resultGrouped = await pool.request().query(`
            SELECT 
                MAX(O.CodigoOrden) as CodigoOrden,
                MAX(O.Cliente) as Cliente,
                MAX(O.DescripcionTrabajo) as Descripcion,
                MAX(O.FechaIngreso) as FechaIngreso,
                MAX(O.CostoTotal) as Precio,
                MAX(O.Magnitud) as Cantidad,
                MAX(O.PerfilesPrecio) as PerfilesPrecio,
                E.CodigoQR as V3String,
                COUNT(DISTINCT LB.BultoID) as CantidadBultos,
                MAX(PC.EstadoSyncReact) as EstadoSyncReact,
                MAX(PC.ObsReact) as ObsReact,
                MAX(PC.EstadoSyncERP) as EstadoSyncERP,
                MAX(PC.ObsERP) as ObsERP,
                MAX(PC.Moneda) as Moneda,
                MAX(PCD.LogPrecioAplicado) as LogFacturacion,
                STRING_AGG(LB.CodigoEtiqueta, ', ') as BultosList
            FROM Logistica_Bultos LB
            JOIN Etiquetas E ON LB.CodigoEtiqueta = E.CodigoEtiqueta
            LEFT JOIN Ordenes O ON LB.OrdenID = O.OrdenID
            LEFT JOIN PedidosCobranzaDetalle PCD ON O.OrdenID = PCD.OrdenID
            LEFT JOIN PedidosCobranza PC ON PCD.PedidoCobranzaID = PC.ID
            WHERE (LB.UbicacionActual = 'DEPOSITO' OR LB.UbicacionActual = 'LOGISTICA')
              AND LB.Estado = 'EN_STOCK'
            GROUP BY E.CodigoQR
        `);

        res.json(resultGrouped.recordset);
    } catch (err) {
        logger.error("Error getDepositStock:", err);
        res.status(500).json({ error: err.message });
    }
};

// getExternalToken removido - erpSyncService maneja la escritura directa en DB

const ERPSyncService = require('../services/erpSyncService');

exports.syncDepositStock = async (req, res) => {
    try {
        const { items } = req.body; // Array de { qr, ... }
        if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Formato incorrecto. Se espera array "items"' });

        const pool = await getPool();
        const { isProcessActive } = require('./configuracionesController');

        const isReactGlobalActive = await isProcessActive('SYNC_REACT_CORE');
        const isErpGlobalActive = await isProcessActive('SYNC_ERP_MACROSOFT');

        const results = [];

        // 1. Identificar NoDocERP únicos y mapear Bultos / Notas
        const docsToSync = new Map(); // Map de noDocERP -> { bultoCode, notes }

        for (const item of items) {
            let code = null;
            let bultoRef = null;

            if (item.qr) {
                // Soportar formato tradicional $[ID]$*...
                const parts = item.qr.split('$*');
                code = parts[0].trim();

                // Si el código trae el prefijo $, lo quitamos para la consulta DB
                if (code.startsWith('$')) {
                    code = code.substring(1);
                }

                if (code.startsWith('B')) bultoRef = code;
                logger.info(`[SyncLogistics] Procesando item con código: ${code} (Bulto: ${bultoRef || 'No'})`);
            } else if (item.noDocERP) {
                const docId = item.noDocERP.toString().trim();
                logger.info(`[SyncLogistics] Procesando por NoDocERP directo: ${docId}`);
                if (!docsToSync.has(docId)) docsToSync.set(docId, { bultoCode: null, notes: '', price: null, quantity: null, profile: null, reactPayload: null, erpPayload: null });
                continue;
            }

            if (code) {
                const isBulto = code.startsWith('B');
                let query = "";
                let queryParam = code;

                if (isBulto) {
                    query = "SELECT TOP 1 O.NoDocERP FROM Ordenes O JOIN Etiquetas E ON O.OrdenID = E.OrdenID WHERE E.CodigoEtiqueta = @Code";
                } else if (code.startsWith('ORD-')) {
                    // Si viene como ORD-12345, intentamos buscar por OrdenID directamente
                    const idPart = code.replace('ORD-', '');
                    if (!isNaN(idPart)) {
                        query = "SELECT TOP 1 NoDocERP FROM Ordenes WHERE OrdenID = @ID OR CodigoOrden = @Code";
                        queryParam = idPart;
                    } else {
                        query = "SELECT TOP 1 NoDocERP FROM Ordenes WHERE CodigoOrden = @Code OR CodigoOrden LIKE @Code + ' (%)' OR NoDocERP = @Code";
                    }
                } else {
                    query = "SELECT TOP 1 NoDocERP FROM Ordenes WHERE CodigoOrden = @Code OR CodigoOrden LIKE @Code + ' (%)' OR NoDocERP = @Code OR REPLACE(NoDocERP, 'RE-', '') = @Code";
                }

                const orderInfo = await pool.request()
                    .input('Code', sql.VarChar, code)
                    .input('ID', sql.Int, isNaN(queryParam) ? 0 : parseInt(queryParam))
                    .query(query);

                // Fallback: Si no se encontró por QR, intentar por CodigoOrden explícito si existe
                if (orderInfo.recordset.length === 0 && item.CodigoOrden) {
                    logger.info(`[SyncLogistics] Fallback: Buscando por CodigoOrden explícito: ${item.CodigoOrden}`);
                    const fallbackInfo = await pool.request()
                        .input('C', sql.VarChar, item.CodigoOrden)
                        .query("SELECT TOP 1 NoDocERP FROM Ordenes WHERE CodigoOrden = @C OR CodigoOrden LIKE @C + ' (%)'");
                    if (fallbackInfo.recordset.length > 0) {
                        orderInfo.recordset = fallbackInfo.recordset;
                    }
                }

                if (orderInfo.recordset.length > 0 && orderInfo.recordset[0].NoDocERP) {
                    const docId = orderInfo.recordset[0].NoDocERP.toString().trim();
                    logger.info(`[SyncLogistics] Documento encontrado: ${docId} para código: ${code}`);
                    const existing = docsToSync.get(docId) || { bultoCode: null, notes: '', price: null, quantity: null, profile: null, reactPayload: null, erpPayload: null };

                    docsToSync.set(docId, {
                        bultoCode: bultoRef || existing.bultoCode,
                        notes: item.notes || existing.notes,
                        price: item.price !== undefined ? item.price : existing.price,
                        quantity: item.quantity !== undefined ? item.quantity : existing.quantity,
                        profile: item.profile !== undefined ? item.profile : existing.profile,
                        reactPayload: item.reactPayload || existing.reactPayload,
                        erpPayload: item.erpPayload || existing.erpPayload
                    });
                } else {
                    logger.info(`[SyncLogistics] NO se encontró NoDocERP en la base de datos para: ${code}`);
                }
            }
        }

        logger.info(`[SyncLogistics] Total de documentos únicos a sincronizar: ${docsToSync.size}`, Array.from(docsToSync.keys()));

        // 2. Ejecutar Sincronización Integral por Documento
        for (const [doc, data] of docsToSync.entries()) {
            try {
                logger.info(`[SyncLogistics] Ejecutando Sync Integral para Doc: ${doc} ${data.bultoCode ? '(Bulto: ' + data.bultoCode + ')' : ''}`);

                const syncRes = await ERPSyncService.syncFinalOrderIntegration(doc, req.user?.id || 1, req.user?.usuario || 'Sistema', data.bultoCode, {
                    userNotes: data.notes,
                    priceOverride: data.price,
                    quantityOverride: data.quantity,
                    profileOverride: data.profile,
                    syncTarget: req.body.target,
                    forcedReactPayload: data.reactPayload,
                    forcedErpPayload: data.erpPayload,
                    isReactEnabledGlobal: isReactGlobalActive,
                    isErpEnabledGlobal: isErpGlobalActive
                });

                results.push({
                    document: doc,
                    success: syncRes.success,
                    total: syncRes.totalPriceSum,
                    react: syncRes.reactSuccess ? 'OK' : 'Error',
                    erp: syncRes.erpSuccess ? 'OK' : 'Error'
                });
            } catch (docErr) {
                logger.error(`[SyncLogistics] Error en documento ${doc}:`, docErr.message);
                results.push({
                    document: doc,
                    success: false,
                    error: docErr.message
                });
            }
        }

        res.json({ success: true, results });

    } catch (err) {
        logger.error("Error syncDepositStock:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.recalculateDepositStockPrices = async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Array "items" requerido' });

        const pool = await getPool();
        const results = [];
        const processedDocs = new Set();

        for (const item of items) {
            if (!item.qr) continue;

            const qrString = item.qr.startsWith('$') ? item.qr.substring(1) : item.qr;
            const cleanQR = qrString.split('$*')[0].trim();

            const docQuery = `
                SELECT TOP 1 O.NoDocERP 
                FROM Ordenes O
                LEFT JOIN Etiquetas E ON O.OrdenID = E.OrdenID
                WHERE E.CodigoQR = @QR 
                   OR E.CodigoEtiqueta = @QR
                   OR O.CodigoOrden = @QR
                   OR O.CodigoOrden LIKE @QR + ' (%)'
            `;

            const orderInfo = await pool.request().input('QR', sql.VarChar, cleanQR).query(docQuery);

            if (orderInfo.recordset.length > 0 && orderInfo.recordset[0].NoDocERP) {
                const docId = orderInfo.recordset[0].NoDocERP.toString().trim();
                const syncRes = await ERPSyncService.syncFinalOrderIntegration(docId, req.user?.id || 1, req.user?.usuario || 'Sistema', null, {
                    onlyCalculate: true,
                    priceOverride: item.price,
                    quantityOverride: item.quantity,
                    profileOverride: item.profile
                });

                results.push({
                    qr: item.qr,
                    document: docId,
                    success: syncRes.success,
                    total: syncRes.totalPriceSum,
                    currency: syncRes.targetCurrency,
                    reactPayload: syncRes.reactPayload,
                    erpPayload: syncRes.erpPayload
                });
            }
        }

        res.json(results);
    } catch (err) {
        logger.error("Error recalculateDepositStockPrices:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.releaseDepositStock = async (req, res) => {
    const { items } = req.body; // items: [{ qr: "..." }]
    if (!items || items.length === 0) return res.json({ success: true, count: 0 });

    let releasedCount = 0;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        const affectedOrderIds = new Set();

        try {
            for (const item of items) {
                if (!item.qr) continue;

                // 1. Identify Bultos by QR (The QR in 'items' is the V3 string from Etiquetas table)
                // We need to find Bultos linked to Etiquetas linked to this QR

                // First get the Etiqueta Codes for this QR
                // IMPORTANT: The QR in 'Etiquetas' table is unique per row? Or multiple rows/bultos share same QR string?
                // In DepositStockPage, we group by E.CodigoQR. So multiple bultos can form one "Pedido V3".

                // Logic: Release ALL bultos associated with this QR string.

                const updateRes = await new sql.Request(transaction)
                    .input('QR', sql.NVarChar(4000), item.qr)
                    .query(`
                        UPDATE LB
                        SET 
                            LB.Estado = 'ENTREGADO', 
                            LB.UbicacionActual = 'CLIENTE'
                        OUTPUT INSERTED.CodigoEtiqueta, INSERTED.OrdenID
                        FROM Logistica_Bultos LB
                        INNER JOIN Etiquetas E ON LB.CodigoEtiqueta = E.CodigoEtiqueta
                        WHERE E.CodigoQR = @QR 
                          AND LB.UbicacionActual = 'DEPOSITO'
                    `);

                const updatedRows = updateRes.recordset;
                updatedRows.forEach(r => affectedOrderIds.add(r.OrdenID));
                releasedCount += updatedRows.length;

                // Log Movements for each released bulto
                for (const row of updatedRows) {
                    const code = row.CodigoEtiqueta;
                    await new sql.Request(transaction)
                        .input('Cod', sql.VarChar, code)
                        .input('User', sql.Int, req.user?.id || 1)
                        .query(`
                             INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
                             VALUES (@Cod, 'SALIDA', 'DEPOSITO', @User, GETDATE(), 'Liberación por Sincronización', 'EN_STOCK', 'ENTREGADO', 0)
                        `);
                }
            }

            // Close Orders if fully delivered
            for (const oid of affectedOrderIds) {
                if (!oid) continue;
                const pendingRes = await new sql.Request(transaction).input('OID', sql.Int, oid).query("SELECT COUNT(*) as C FROM Logistica_Bultos WHERE OrdenID = @OID AND Estado != 'ENTREGADO'");

                if (pendingRes.recordset[0].C === 0) {
                    await changeOrderState(transaction, {
                        target  : { type: 'ORDER', id: oid },
                        estado  : 'Finalizado',
                        userObj : req.user || 'Sistema',
                        detalle : 'Entrega completa al cliente',
                        extraSet: { EstadoLogistica: 'ENTREGADO', UbicacionActual: 'CLIENTE' },
                        io      : req.app.get('socketio'),
                    });
                }
            }

            await transaction.commit();
            res.json({ success: true, count: releasedCount });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (err) {
        logger.error("Error releaseDepositStock:", err);
        res.status(500).json({ error: err.message });
    }
};
